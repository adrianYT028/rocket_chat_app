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
    public i18nParamsExample = '[recur|stop|list|clear|help]';
    public i18nDescription = 'Manage reminders. Use /remind recur for every-minute nagging, /remind stop to cancel';
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
            .setText('**Reminder Bot Commands**\n\n' +
                     '`/remind` - Create a new reminder\n' +
                     '`/remind schedule [task]` - Schedule a 10-second delayed reminder\n' +
                     '`/remind recur [task]` - Start a recurring reminder (every minute)\n' +
                     '`/remind stop` - Stop your recurring reminder\n' +
                     '`/remind list` - View all your reminders\n' +
                     '`/remind clear` - Clear all your reminders\n' +
                     '`/remind help` - Show this help message')
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
