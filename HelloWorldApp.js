"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HelloWorldApp = void 0;
const App_1 = require("@rocket.chat/apps-engine/definition/App");
const metadata_1 = require("@rocket.chat/apps-engine/definition/metadata");
function parseNaturalDate(text) {
    const now = new Date();
    const textLower = text.toLowerCase();
    let hour = 0;
    let minute = 0;
    let hasTime = false;
    const timeMatch = textLower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
    if (timeMatch) {
        hour = parseInt(timeMatch[1]);
        minute = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
        const meridiem = timeMatch[3];
        if (meridiem === 'pm' && hour < 12)
            hour += 12;
        if (meridiem === 'am' && hour === 12)
            hour = 0;
        hasTime = true;
    }
    if (textLower.includes('in ')) {
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
    if (textLower.includes('tomorrow') || textLower.includes('tommorow') || textLower.includes('tmrw')) {
        const tomorrow = new Date(now);
        tomorrow.setDate(now.getDate() + 1);
        if (hasTime) {
            tomorrow.setHours(hour, minute, 0, 0);
        }
        else {
            tomorrow.setHours(9, 0, 0, 0);
        }
        return tomorrow;
    }
    if (textLower.includes('today')) {
        const today = new Date(now);
        if (hasTime) {
            today.setHours(hour, minute, 0, 0);
        }
        return today;
    }
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    for (let i = 0; i < days.length; i++) {
        if (textLower.includes(days[i])) {
            const targetDay = i;
            const currentDay = now.getDay();
            let daysToAdd = targetDay - currentDay;
            if (daysToAdd <= 0 || textLower.includes('next')) {
                daysToAdd += 7;
            }
            const targetDate = new Date(now);
            targetDate.setDate(now.getDate() + daysToAdd);
            if (hasTime) {
                targetDate.setHours(hour, minute, 0, 0);
            }
            else {
                targetDate.setHours(9, 0, 0, 0);
            }
            return targetDate;
        }
    }
    if (hasTime) {
        const result = new Date(now);
        result.setHours(hour, minute, 0, 0);
        if (result <= now) {
            result.setDate(result.getDate() + 1);
        }
        return result;
    }
    return null;
}
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
        this.i18nParamsExample = '[call mom tomorrow at 5pm|recur|stop|list|clear|help]';
        this.i18nDescription = 'Smart reminder bot with natural language parsing. Try: /remind call mom tomorrow at 5pm';
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
        if (args.length > 0) {
            const rawText = args.join(' ');
            const parsedDate = parseNaturalDate(rawText);
            if (parsedDate) {
                const now = new Date();
                const delayMs = parsedDate.getTime() - now.getTime();
                if (delayMs > 0) {
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
                }
                else {
                    const message = modify.getCreator().startMessage()
                        .setRoom(context.getRoom())
                        .setSender(sender)
                        .setText(`⚠️ That time is in the past! Try a future date like "tomorrow at 3pm"`);
                    await modify.getCreator().finish(message);
                    return;
                }
            }
            else {
                const message = modify.getCreator().startMessage()
                    .setRoom(context.getRoom())
                    .setSender(sender)
                    .setText(`🤔 **I didn't catch the time.**\nTry typing: \`/remind Check servers tomorrow at 9am\``);
                await modify.getCreator().finish(message);
                return;
            }
        }
        if (triggerId) {
            await openReminderModal(modify, triggerId, sender);
        }
    }
    async showHelp(modify, room, user) {
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
