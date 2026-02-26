import {
    IAppAccessors,
    IConfigurationExtend,
    IHttp,
    ILogger,
    IModify,
    IPersistence,
    IRead,
} from '@rocket.chat/apps-engine/definition/accessors';
import { App } from '@rocket.chat/apps-engine/definition/App';
import { IAppInfo, RocketChatAssociationModel, RocketChatAssociationRecord } from '@rocket.chat/apps-engine/definition/metadata';
import { IJobContext, IProcessor } from '@rocket.chat/apps-engine/definition/scheduler';
import { ISlashCommand, SlashCommandContext } from '@rocket.chat/apps-engine/definition/slashcommands';
import { IUIKitInteractionHandler, IUIKitResponse, UIKitViewSubmitInteractionContext } from '@rocket.chat/apps-engine/definition/uikit';

/**
 * Custom date parser - built from scratch to avoid external dependencies
 * Parses natural language date/time expressions into JavaScript Date objects
 */
function parseNaturalDate(text: string): Date | null {
    const now = new Date();
    const textLower = text.toLowerCase();

    // Extract time (e.g., "5pm", "17:00", "3:30pm")
    let hour = 0;
    let minute = 0;
    let hasTime = false;

    // Match patterns like "5pm", "5:30pm", "17:00"
    const timeMatch = textLower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
    if (timeMatch) {
        hour = parseInt(timeMatch[1]);
        minute = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
        const meridiem = timeMatch[3];

        if (meridiem === 'pm' && hour < 12) hour += 12;
        if (meridiem === 'am' && hour === 12) hour = 0;

        hasTime = true;
    }

    // Check for relative time expressions
    if (textLower.includes('in ')) {
        // "in 2 days", "in 2 hours", "in 30 minutes", "in 10 seconds"
        const daysMatch = textLower.match(/in (\d+) days?/);
        const hoursMatch = textLower.match(/in (\d+) hours?/);
        const minutesMatch = textLower.match(/in (\d+) (?:minutes?|mins?)/);
        const secondsMatch = textLower.match(/in (\d+) (?:seconds?|secs?)/);

        if (daysMatch) {
            const daysToAdd = parseInt(daysMatch[1]);
            return new Date(now.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
        }
        if (hoursMatch) {
            const hoursToAdd = parseInt(hoursMatch[1]);
            return new Date(now.getTime() + hoursToAdd * 60 * 60 * 1000);
        }
        if (minutesMatch) {
            const minutesToAdd = parseInt(minutesMatch[1]);
            return new Date(now.getTime() + minutesToAdd * 60 * 1000);
        }
        if (secondsMatch) {
            const secondsToAdd = parseInt(secondsMatch[1]);
            return new Date(now.getTime() + secondsToAdd * 1000);
        }
    }

    // Check for "tomorrow" (handle common misspelling "tommorow")
    if (textLower.includes('tomorrow') || textLower.includes('tommorow') || textLower.includes('tmrw')) {
        const tomorrow = new Date(now);
        tomorrow.setDate(now.getDate() + 1);
        if (hasTime) {
            tomorrow.setHours(hour, minute, 0, 0);
        } else {
            tomorrow.setHours(9, 0, 0, 0); // Default to 9am
        }
        return tomorrow;
    }

    // Check for "today"
    if (textLower.includes('today')) {
        const today = new Date(now);
        if (hasTime) {
            today.setHours(hour, minute, 0, 0);
        }
        return today;
    }

    // Check for day of week (e.g., "next monday", "friday")
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    for (let i = 0; i < days.length; i++) {
        if (textLower.includes(days[i])) {
            const targetDay = i;
            const currentDay = now.getDay();
            let daysToAdd = targetDay - currentDay;

            // If day has passed this week or is today and time has passed, go to next week
            if (daysToAdd <= 0 || textLower.includes('next')) {
                daysToAdd += 7;
            }

            const targetDate = new Date(now);
            targetDate.setDate(now.getDate() + daysToAdd);

            if (hasTime) {
                targetDate.setHours(hour, minute, 0, 0);
            } else {
                targetDate.setHours(9, 0, 0, 0); // Default to 9am
            }
            return targetDate;
        }
    }

    // If we found a time but no date, assume today
    if (hasTime) {
        const result = new Date(now);
        result.setHours(hour, minute, 0, 0);

        // If time has already passed today, assume tomorrow
        if (result <= now) {
            result.setDate(result.getDate() + 1);
        }
        return result;
    }

    return null;
}

/**
 * Opens a modal dialog for creating a reminder.
 *
 * Why a modal? It provides a better UX than asking users to type everything in one command.
 * The form validation and multi-line support make it easier to create detailed reminders.
 * The triggerId ensures this modal is shown to the specific user who invoked the command.
 */
async function openReminderModal(modify: IModify, triggerId: string, user: any): Promise<void> {
    const blockBuilder = modify.getCreator().getBlockBuilder();

    const blocks = blockBuilder.addInputBlock({
        blockId: 'reminder_block',
        label: blockBuilder.newPlainTextObject('What would you like to be reminded about?'),
        element: blockBuilder.newPlainTextInputElement({
            actionId: 'task_input',
            placeholder: blockBuilder.newPlainTextObject('Enter task description'),
        }),
    }).getBlocks();

    await modify.getUiController().openModalView(
        {
            id: 'reminder_modal',
            title: blockBuilder.newPlainTextObject('Create Reminder'),
            blocks: blocks,
            submit: blockBuilder.newButtonElement({
                text: blockBuilder.newPlainTextObject('Save'),
            }),
        },
        { triggerId },
        user
    );
}

/**
 * Sends a direct message to the specified user.
 *
 * Why DMs? Confirmation messages shouldn't clutter public channels.
 * This keeps the user's workspace clean while still providing feedback.
 * The 'ReminderBot' alias helps users identify automated messages.
 */
async function sendDirectMessage(modify: IModify, read: IRead, user: any, messageText: string): Promise<void> {
    const messageBuilder = modify.getCreator().startMessage()
        .setText(messageText)
        .setUsernameAlias('ReminderBot');

    const directRoom = await read.getRoomReader().getDirectByUsernames([user.username]);

    if (directRoom) {
        messageBuilder.setRoom(directRoom);
        await modify.getCreator().finish(messageBuilder);
    }
}

class RemindCommand implements ISlashCommand {
    public command = 'remind';
    public i18nParamsExample = '[call mom tomorrow at 5pm|recur|stop|list|clear|help]';
    public i18nDescription = 'Smart reminder bot with natural language parsing. Try: /remind call mom tomorrow at 5pm';
    public providesPreview = false;

    constructor(private readonly app: App) {}

    public async executor(context: SlashCommandContext, read: IRead, modify: IModify, http: IHttp, persis: IPersistence): Promise<void> {
        const triggerId = context.getTriggerId();
        const sender = context.getSender();
        const args = context.getArguments();

        // Using early returns for each command path keeps the code flat and readable.
        // This prevents deep nesting and makes it easy to add new commands later.

        if (args.length > 0 && args[0].toLowerCase() === 'schedule') {
            // Join all args after 'schedule' to support multi-word tasks without quotes
            const task = args.slice(1).join(' ') || 'Take a break';

            // Hard-coded 10 seconds for MVP to prove the scheduler works.
            // In production, this would parse user-specified times ("5m", "2h", "tomorrow")
            await modify.getScheduler().scheduleOnce({
                id: 'reminder_job',
                when: '10 seconds',
                // The scheduler doesn't preserve context automatically, so we must
                // explicitly pass user and room IDs to reconstruct the context later
                data: {
                    task: task,
                    userId: sender.id,
                    roomId: context.getRoom().id
                }
            });

            // Confirm to user
            const message = modify.getCreator().startMessage()
                .setRoom(context.getRoom())
                .setSender(sender)
                .setText(`⏳ I will remind you in **10 seconds** about: "${task}". Watch this space...`);

            await modify.getCreator().finish(message);
            return;
        }

        // Check if user wants recurring reminders (every minute)
        if (args.length > 0 && args[0].toLowerCase() === 'recur') {
            const task = args.slice(1).join(' ') || 'Nagging reminder';

            // Cron expression: every minute
            // Format: "* * * * *" means: every minute, every hour, every day, every month, every day of week
            await modify.getScheduler().scheduleRecurring({
                id: 'recurring_reminder',
                interval: '* * * * *',
                data: {
                    task: task,
                    userId: sender.id,
                    roomId: context.getRoom().id
                }
            });

            const message = modify.getCreator().startMessage()
                .setRoom(context.getRoom())
                .setSender(sender)
                .setText(`🔄 **Recurring reminder started!** I'll nag you every minute about: "${task}"\n\nUse \`/remind stop\` to make it stop.`);

            await modify.getCreator().finish(message);
            return;
        }

        // Check if user wants to stop recurring reminders
        if (args.length > 0 && args[0].toLowerCase() === 'stop') {
            try {
                await modify.getScheduler().cancelJob('recurring_reminder');

                const message = modify.getCreator().startMessage()
                    .setRoom(context.getRoom())
                    .setSender(sender)
                    .setText('🛑 Recurring reminder stopped. Peace at last!');

                await modify.getCreator().finish(message);
            } catch (e) {
                const message = modify.getCreator().startMessage()
                    .setRoom(context.getRoom())
                    .setSender(sender)
                    .setText('❌ No active recurring reminder found.');

                await modify.getCreator().finish(message);
            }
            return;
        }

        // Check if user wants to list reminders
        if (args.length > 0 && args[0].toLowerCase() === 'list') {
            await this.listReminders(sender, read, modify, persis, context.getRoom());
            return;
        }

        // Check if user wants to clear reminders
        if (args.length > 0 && args[0].toLowerCase() === 'clear') {
            await this.clearReminders(sender, read, modify, persis, context.getRoom());
            return;
        }

        if (args.length > 0 && (args[0].toLowerCase() === 'help' || args[0] === '?')) {
            await this.showHelp(modify, context.getRoom(), sender);
            return;
        }

        // Smart Natural Language Processing
        // If user typed something that's not a command, try to parse it as a date/time
        if (args.length > 0) {
            const rawText = args.join(' ');
            const parsedDate = parseNaturalDate(rawText);

            if (parsedDate) {
                // SUCCESS: We found a date!
                // Calculate time difference for scheduling
                const now = new Date();
                const delayMs = parsedDate.getTime() - now.getTime();

                if (delayMs > 0) {
                    // Schedule the reminder
                    await modify.getScheduler().scheduleOnce({
                        id: 'reminder_job',
                        when: parsedDate.toISOString(),
                        data: {
                            task: rawText,
                            userId: sender.id,
                            roomId: context.getRoom().id
                        }
                    });

                    const message = modify.getCreator().startMessage()
                        .setRoom(context.getRoom())
                        .setSender(sender)
                        .setText(`🧠 **Smart Schedule:** \nI understood: **"${rawText}"**\n📅 **Target Date:** ${parsedDate.toLocaleString('en-IN', {
                            weekday: 'short',
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                            timeZone: 'Asia/Kolkata',
                            timeZoneName: 'short'
                        })}`);

                    await modify.getCreator().finish(message);
                    return;
                } else {
                    // Date is in the past
                    const message = modify.getCreator().startMessage()
                        .setRoom(context.getRoom())
                        .setSender(sender)
                        .setText(`⚠️ That time is in the past! Try a future date like "tomorrow at 3pm"`);

                    await modify.getCreator().finish(message);
                    return;
                }
            } else {
                // No date found in text
                const message = modify.getCreator().startMessage()
                    .setRoom(context.getRoom())
                    .setSender(sender)
                    .setText(`🤔 **I didn't catch the time.**\nTry typing: \`/remind Check servers tomorrow at 9am\``);

                await modify.getCreator().finish(message);
                return;
            }
        }

        // Default action: open modal for creating reminders.
        // Why not accept task text directly as args? Modals provide better UX:
        // - Multi-line support for detailed tasks
        // - Future extensibility (date pickers, dropdowns)
        // - Built-in validation feedback
        if (triggerId) {
            await openReminderModal(modify, triggerId, sender);
        }
    }

    private async showHelp(modify: IModify, room: any, user: any): Promise<void> {
        const message = modify.getCreator().startMessage()
            .setText('**🧠 Smart Reminder Bot Commands**\n\n' +
                     '**Natural Language (NEW!):**\n' +
                     '`/remind call mom tomorrow at 5pm` - Smart scheduling!\n' +
                     '`/remind meeting in 2 hours` - Works with relative times\n' +
                     '`/remind dentist next Friday at 3pm` - Understands dates\n\n' +
                     '**Other Commands:**\n' +
                     '`/remind` - Create a new reminder via form\n' +
                     '`/remind schedule [task]` - 10-second test reminder\n' +
                     '`/remind recur [task]` - Every-minute recurring reminder\n' +
                     '`/remind stop` - Stop recurring reminder\n' +
                     '`/remind list` - View all reminders\n' +
                     '`/remind clear` - Clear all reminders\n' +
                     '`/remind help` - Show this message')
            .setRoom(room)
            .setSender(user);

        await modify.getCreator().finish(message);
    }

    private async listReminders(user: any, read: IRead, modify: IModify, persis: IPersistence, room: any): Promise<void> {
        try {
            // Associations provide automatic data isolation per user.
            // We don't need to manually filter by userId in queries - the engine does it.
            // This pattern also scales well for multi-workspace deployments.
            const association = new RocketChatAssociationRecord(
                RocketChatAssociationModel.USER,
                user.id
            );

            const reminders = await read.getPersistenceReader().readByAssociation(association) as Array<any>;

            // Always provide explicit feedback, even for empty states.
            // Silent failures confuse users - they don't know if the command worked.
            if (!reminders || reminders.length === 0) {
                const message = modify.getCreator().startMessage()
                    .setText('You have no saved reminders.')
                    .setRoom(room)
                    .setSender(user);
                await modify.getCreator().finish(message);
                return;
            }

            let messageText = `📋 **Your Reminders** (${reminders.length} total)\n\n`;

            reminders.forEach((reminder, index) => {
                // Using en-US locale for consistency across all users.
                // In a production app, we'd use the user's locale preference.
                // Showing creation time (not due time) since we don't have scheduling yet.
                const date = new Date(reminder.createdAt);
                const dateStr = date.toLocaleString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });
                const status = reminder.completed ? '✅' : '-';
                messageText += `${index + 1}. ${status} **${reminder.task}**\n   _Created: ${dateStr}_\n\n`;
            });

            const message = modify.getCreator().startMessage()
                .setText(messageText)
                .setRoom(room)
                .setSender(user);

            await modify.getCreator().finish(message);
        } catch (e) {
            // Fail gracefully with a user-friendly message.
            // Never expose technical error details to users - log them instead.
            // This prevents confusion and potential security issues.
            const message = modify.getCreator().startMessage()
                .setText('❌ Error fetching reminders.')
                .setRoom(room)
                .setSender(user);
            await modify.getCreator().finish(message);
        }
    }

    private async clearReminders(user: any, read: IRead, modify: IModify, persis: IPersistence, room: any): Promise<void> {
        try {
            // Associations provide automatic data isolation per user.
            // We don't need to manually filter by userId in queries - the engine does it.
            // This pattern also scales well for multi-workspace deployments.
            const association = new RocketChatAssociationRecord(
                RocketChatAssociationModel.USER,
                user.id
            );

            const reminders = await read.getPersistenceReader().readByAssociation(association) as Array<any>;

            // Check before deleting to avoid redundant operations and provide better UX.
            // Users get immediate feedback if there's nothing to clear.
            if (!reminders || reminders.length === 0) {
                const message = modify.getCreator().startMessage()
                    .setText('You have no reminders to clear.')
                    .setRoom(room)
                    .setSender(user);
                await modify.getCreator().finish(message);
                return;
            }

            // Store count before deletion so we can show how many were removed.
            // This confirmation builds user trust that the action actually worked.
            const count = reminders.length;
            await persis.removeByAssociation(association);

            const message = modify.getCreator().startMessage()
                .setText(`🗑️ Successfully cleared ${count} reminder${count === 1 ? '' : 's'}.`)
                .setRoom(room)
                .setSender(user);

            await modify.getCreator().finish(message);
        } catch (e) {
            // Fail gracefully with a user-friendly message.
            // Never expose technical error details to users - log them instead.
            const message = modify.getCreator().startMessage()
                .setText('❌ Error clearing reminders.')
                .setRoom(room)
                .setSender(user);
            await modify.getCreator().finish(message);
        }
    }
}

export class HelloWorldApp extends App implements IUIKitInteractionHandler {
    constructor(info: IAppInfo, logger: ILogger, accessors: IAppAccessors) {
        super(info, logger, accessors);
    }

    /**
     * Background job processor for scheduled reminders.
     *
     * Why separate from the command executor? The scheduler runs this in a different
     * context, potentially minutes or hours later. We need to reconstruct the user
     * and room from the stored IDs since the original command context is long gone.
     */
    private async reminderProcessor(jobContext: IJobContext, read: IRead, modify: IModify, http: IHttp, persistence: IPersistence): Promise<void> {
        const data = jobContext as any;

        try {
            // Reconstruct the context from stored IDs.
            // If either lookup fails, the reminder silently fails (logged below).
            const user = await read.getUserReader().getById(data.userId);
            const room = await read.getRoomReader().getById(data.roomId);

            // Guard against missing user/room (deleted after scheduling, etc).
            // Failing silently here is intentional - the user won't see an error
            // for a reminder they may have forgotten about anyway.
            if (user && room) {
                const message = modify.getCreator().startMessage()
                    .setRoom(room)
                    .setSender(user)
                    .setText(`⏰ **BEEP BEEP!** This is your delayed reminder: "${data.task}"`);

                await modify.getCreator().finish(message);
            }
        } catch (error) {
            // Log but don't throw - throwing here would mark the job as failed
            // and the scheduler might retry it unnecessarily.
            this.getLogger().error('Error in reminderProcessor:', error);
        }
    }

    public async extendConfiguration(configuration: IConfigurationExtend): Promise<void> {
        // Register slash command for user interaction
        await configuration.slashCommands.provideSlashCommand(new RemindCommand(this));

        // Register the processor BEFORE any jobs are scheduled.
        // The scheduler needs to know what function to call when jobs trigger.
        // The ID 'reminder_job' links scheduleOnce() calls to this processor.
        // .bind(this) ensures the method has access to the app instance.
        await configuration.scheduler.registerProcessors([
            {
                id: 'reminder_job',
                processor: this.reminderProcessor.bind(this),
            },
            // Register processor for recurring reminders.
            // All users share this processor - user context is in job data
            {
                id: 'recurring_reminder',
                processor: this.reminderProcessor.bind(this),
            },
        ]);
    }

    /**
     * Handles form submissions from the reminder creation modal.
     *
     * Why implement IUIKitInteractionHandler? This interface lets us respond to
     * modal interactions. Without it, clicking "Save" would do nothing.
     * The engine routes modal submissions here based on the modal's ID.
     */
    public async executeViewSubmitHandler(
        context: UIKitViewSubmitInteractionContext,
        read: IRead,
        http: IHttp,
        persistence: IPersistence,
        modify: IModify
    ): Promise<IUIKitResponse> {
        try {
            const data = context.getInteractionData();
            // Extract task from the block structure. The nested path matches our modal definition.
            // Fallback to 'no task' prevents crashes if the structure changes.
            const task = data.view.state?.['reminder_block']?.['task_input'] || 'no task';

            // Associate with user so reminders are isolated per-user automatically
            const association = new RocketChatAssociationRecord(
                RocketChatAssociationModel.USER,
                data.user.id
            );

            await persistence.createWithAssociation(
                {
                    task,
                    createdAt: new Date(),
                    // 'completed' flag enables future features like marking tasks done
                    completed: false,
                    // Storing both userId and username seems redundant, but username
                    // is useful for debugging and potential export features
                    userId: data.user.id,
                    username: data.user.username
                },
                association
            );

            // Confirmation via DM instead of in-channel keeps channels clean
            await sendDirectMessage(modify, read, data.user, `✅ Reminder saved: "${task}"`);

            return context.getInteractionResponder().successResponse();
        } catch (e) {
            this.getLogger().error('Error saving reminder:', e);
            return context.getInteractionResponder().errorResponse();
        }
    }
}
