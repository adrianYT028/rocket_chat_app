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
 * Opens a modal dialog for creating a reminder
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
 * Sends a direct message to the specified user
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
    public i18nParamsExample = '[list|clear|help]';
    public i18nDescription = 'Manage reminders. Use /remind to create, /remind list to view, /remind clear to delete all';
    public providesPreview = false;

    constructor(private readonly app: App) {}

    public async executor(context: SlashCommandContext, read: IRead, modify: IModify, http: IHttp, persis: IPersistence): Promise<void> {
        const triggerId = context.getTriggerId();
        const sender = context.getSender();
        const args = context.getArguments();

        // Check if user wants to schedule a delayed reminder
        if (args.length > 0 && args[0].toLowerCase() === 'schedule') {
            const task = args.slice(1).join(' ') || 'Take a break';

            // Schedule it for 10 seconds from now
            await modify.getScheduler().scheduleOnce({
                id: 'reminder_job',
                when: '10 seconds',
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

        // Show help if asked
        if (args.length > 0 && (args[0].toLowerCase() === 'help' || args[0] === '?')) {
            await this.showHelp(modify, context.getRoom(), sender);
            return;
        }

        // Otherwise open the modal to create a reminder
        if (triggerId) {
            await openReminderModal(modify, triggerId, sender);
        }
    }

    private async showHelp(modify: IModify, room: any, user: any): Promise<void> {
        const message = modify.getCreator().startMessage()
            .setText('**Reminder Bot Commands**\n\n' +
                     '`/remind` - Create a new reminder\n' +
                     '`/remind schedule [task]` - Schedule a 10-second delayed reminder\n' +
                     '`/remind list` - View all your reminders\n' +
                     '`/remind clear` - Clear all your reminders\n' +
                     '`/remind help` - Show this help message')
            .setRoom(room)
            .setSender(user);

        await modify.getCreator().finish(message);
    }

    private async listReminders(user: any, read: IRead, modify: IModify, persis: IPersistence, room: any): Promise<void> {
        try {
            // Fetch all reminders for this user
            const association = new RocketChatAssociationRecord(
                RocketChatAssociationModel.USER,
                user.id
            );

            const reminders = await read.getPersistenceReader().readByAssociation(association) as Array<any>;

            if (!reminders || reminders.length === 0) {
                const message = modify.getCreator().startMessage()
                    .setText('You have no saved reminders.')
                    .setRoom(room)
                    .setSender(user);
                await modify.getCreator().finish(message);
                return;
            }

            // Format the reminders list
            let messageText = `📋 **Your Reminders** (${reminders.length} total)\n\n`;

            reminders.forEach((reminder, index) => {
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
            const message = modify.getCreator().startMessage()
                .setText('❌ Error fetching reminders.')
                .setRoom(room)
                .setSender(user);
            await modify.getCreator().finish(message);
        }
    }

    private async clearReminders(user: any, read: IRead, modify: IModify, persis: IPersistence, room: any): Promise<void> {
        try {
            // Fetch all reminders for this user
            const association = new RocketChatAssociationRecord(
                RocketChatAssociationModel.USER,
                user.id
            );

            const reminders = await read.getPersistenceReader().readByAssociation(association) as Array<any>;

            if (!reminders || reminders.length === 0) {
                const message = modify.getCreator().startMessage()
                    .setText('You have no reminders to clear.')
                    .setRoom(room)
                    .setSender(user);
                await modify.getCreator().finish(message);
                return;
            }

            // Delete all reminders
            const count = reminders.length;
            await persis.removeByAssociation(association);

            const message = modify.getCreator().startMessage()
                .setText(`🗑️ Successfully cleared ${count} reminder${count === 1 ? '' : 's'}.`)
                .setRoom(room)
                .setSender(user);

            await modify.getCreator().finish(message);
        } catch (e) {
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
     * Processor that handles scheduled reminder jobs
     */
    private async reminderProcessor(jobContext: IJobContext, read: IRead, modify: IModify, http: IHttp, persistence: IPersistence): Promise<void> {
        const data = jobContext as any;

        try {
            const user = await read.getUserReader().getById(data.userId);
            const room = await read.getRoomReader().getById(data.roomId);

            if (user && room) {
                const message = modify.getCreator().startMessage()
                    .setRoom(room)
                    .setSender(user)
                    .setText(`⏰ **BEEP BEEP!** This is your delayed reminder: "${data.task}"`);

                await modify.getCreator().finish(message);
            }
        } catch (error) {
            this.getLogger().error('Error in reminderProcessor:', error);
        }
    }

    public async extendConfiguration(configuration: IConfigurationExtend): Promise<void> {
        await configuration.slashCommands.provideSlashCommand(new RemindCommand(this));

        // Register the scheduler processor
        await configuration.scheduler.registerProcessors([
            {
                id: 'reminder_job',
                processor: this.reminderProcessor.bind(this),
            },
        ]);
    }

    public async executeViewSubmitHandler(
        context: UIKitViewSubmitInteractionContext,
        read: IRead,
        http: IHttp,
        persistence: IPersistence,
        modify: IModify
    ): Promise<IUIKitResponse> {
        try {
            const data = context.getInteractionData();
            const task = data.view.state?.['reminder_block']?.['task_input'] || 'no task';

            // Save to database
            const association = new RocketChatAssociationRecord(
                RocketChatAssociationModel.USER,
                data.user.id
            );

            await persistence.createWithAssociation(
                {
                    task,
                    createdAt: new Date(),
                    completed: false,
                    userId: data.user.id,
                    username: data.user.username
                },
                association
            );

            // Send confirmation message to user
            await sendDirectMessage(modify, read, data.user, `✅ Reminder saved: "${task}"`);

            return context.getInteractionResponder().successResponse();
        } catch (e) {
            this.getLogger().error('Error saving reminder:', e);
            return context.getInteractionResponder().errorResponse();
        }
    }
}
