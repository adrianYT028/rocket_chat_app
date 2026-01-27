"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HelloWorldApp = void 0;
const App_1 = require("@rocket.chat/apps-engine/definition/App");
const metadata_1 = require("@rocket.chat/apps-engine/definition/metadata");
async function openReminderModal(modify, triggerId, user) {
    const blockBuilder = modify.getCreator().getBlockBuilder();
    const blocks = blockBuilder.addInputBlock({
        blockId: 'reminder_block',
        label: blockBuilder.newPlainTextObject('What would you like to be reminded about?'),
        element: blockBuilder.newPlainTextInputElement({
            actionId: 'task_input',
            placeholder: blockBuilder.newPlainTextObject('Enter task description'),
        }),
    }).getBlocks();
    await modify.getUiController().openModalView({
        id: 'reminder_modal',
        title: blockBuilder.newPlainTextObject('Create Reminder'),
        blocks: blocks,
        submit: blockBuilder.newButtonElement({
            text: blockBuilder.newPlainTextObject('Save'),
        }),
    }, { triggerId }, user);
}
async function sendDirectMessage(modify, read, user, messageText) {
    const messageBuilder = modify.getCreator().startMessage()
        .setText(messageText)
        .setUsernameAlias('ReminderBot');
    const directRoom = await read.getRoomReader().getDirectByUsernames([user.username]);
    if (directRoom) {
        messageBuilder.setRoom(directRoom);
        await modify.getCreator().finish(messageBuilder);
    }
}
class RemindCommand {
    constructor(app) {
        this.app = app;
        this.command = 'remind';
        this.i18nParamsExample = '[recur|stop|list|clear|help]';
        this.i18nDescription = 'Manage reminders. Use /remind recur for every-minute nagging, /remind stop to cancel';
        this.providesPreview = false;
    }
    async executor(context, read, modify, http, persis) {
        const triggerId = context.getTriggerId();
        const sender = context.getSender();
        const args = context.getArguments();
        if (args.length > 0 && args[0].toLowerCase() === 'schedule') {
            const task = args.slice(1).join(' ') || 'Take a break';
            await modify.getScheduler().scheduleOnce({
                id: 'reminder_job',
                when: '10 seconds',
                data: {
                    task: task,
                    userId: sender.id,
                    roomId: context.getRoom().id
                }
            });
            const message = modify.getCreator().startMessage()
                .setRoom(context.getRoom())
                .setSender(sender)
                .setText(`⏳ I will remind you in **10 seconds** about: "${task}". Watch this space...`);
            await modify.getCreator().finish(message);
            return;
        }
        if (args.length > 0 && args[0].toLowerCase() === 'recur') {
            const task = args.slice(1).join(' ') || 'Nagging reminder';
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
        if (args.length > 0 && args[0].toLowerCase() === 'stop') {
            try {
                await modify.getScheduler().cancelJob('recurring_reminder');
                const message = modify.getCreator().startMessage()
                    .setRoom(context.getRoom())
                    .setSender(sender)
                    .setText('🛑 Recurring reminder stopped. Peace at last!');
                await modify.getCreator().finish(message);
            }
            catch (e) {
                const message = modify.getCreator().startMessage()
                    .setRoom(context.getRoom())
                    .setSender(sender)
                    .setText('❌ No active recurring reminder found.');
                await modify.getCreator().finish(message);
            }
            return;
        }
        if (args.length > 0 && args[0].toLowerCase() === 'list') {
            await this.listReminders(sender, read, modify, persis, context.getRoom());
            return;
        }
        if (args.length > 0 && args[0].toLowerCase() === 'clear') {
            await this.clearReminders(sender, read, modify, persis, context.getRoom());
            return;
        }
        if (args.length > 0 && (args[0].toLowerCase() === 'help' || args[0] === '?')) {
            await this.showHelp(modify, context.getRoom(), sender);
            return;
        }
        if (triggerId) {
            await openReminderModal(modify, triggerId, sender);
        }
    }
    async showHelp(modify, room, user) {
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
    async listReminders(user, read, modify, persis, room) {
        try {
            const association = new metadata_1.RocketChatAssociationRecord(metadata_1.RocketChatAssociationModel.USER, user.id);
            const reminders = await read.getPersistenceReader().readByAssociation(association);
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
        }
        catch (e) {
            const message = modify.getCreator().startMessage()
                .setText('❌ Error fetching reminders.')
                .setRoom(room)
                .setSender(user);
            await modify.getCreator().finish(message);
        }
    }
    async clearReminders(user, read, modify, persis, room) {
        try {
            const association = new metadata_1.RocketChatAssociationRecord(metadata_1.RocketChatAssociationModel.USER, user.id);
            const reminders = await read.getPersistenceReader().readByAssociation(association);
            if (!reminders || reminders.length === 0) {
                const message = modify.getCreator().startMessage()
                    .setText('You have no reminders to clear.')
                    .setRoom(room)
                    .setSender(user);
                await modify.getCreator().finish(message);
                return;
            }
            const count = reminders.length;
            await persis.removeByAssociation(association);
            const message = modify.getCreator().startMessage()
                .setText(`🗑️ Successfully cleared ${count} reminder${count === 1 ? '' : 's'}.`)
                .setRoom(room)
                .setSender(user);
            await modify.getCreator().finish(message);
        }
        catch (e) {
            const message = modify.getCreator().startMessage()
                .setText('❌ Error clearing reminders.')
                .setRoom(room)
                .setSender(user);
            await modify.getCreator().finish(message);
        }
    }
}
class HelloWorldApp extends App_1.App {
    constructor(info, logger, accessors) {
        super(info, logger, accessors);
    }
    async reminderProcessor(jobContext, read, modify, http, persistence) {
        const data = jobContext;
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
        }
        catch (error) {
            this.getLogger().error('Error in reminderProcessor:', error);
        }
    }
    async extendConfiguration(configuration) {
        await configuration.slashCommands.provideSlashCommand(new RemindCommand(this));
        await configuration.scheduler.registerProcessors([
            {
                id: 'reminder_job',
                processor: this.reminderProcessor.bind(this),
            },
            {
                id: 'recurring_reminder',
                processor: this.reminderProcessor.bind(this),
            },
        ]);
    }
    async executeViewSubmitHandler(context, read, http, persistence, modify) {
        var _a, _b;
        try {
            const data = context.getInteractionData();
            const task = ((_b = (_a = data.view.state) === null || _a === void 0 ? void 0 : _a['reminder_block']) === null || _b === void 0 ? void 0 : _b['task_input']) || 'no task';
            const association = new metadata_1.RocketChatAssociationRecord(metadata_1.RocketChatAssociationModel.USER, data.user.id);
            await persistence.createWithAssociation({
                task,
                createdAt: new Date(),
                completed: false,
                userId: data.user.id,
                username: data.user.username
            }, association);
            await sendDirectMessage(modify, read, data.user, `✅ Reminder saved: "${task}"`);
            return context.getInteractionResponder().successResponse();
        }
        catch (e) {
            this.getLogger().error('Error saving reminder:', e);
            return context.getInteractionResponder().errorResponse();
        }
    }
}
exports.HelloWorldApp = HelloWorldApp;
