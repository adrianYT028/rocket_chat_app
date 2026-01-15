# What We Built Today: Rocket.Chat Reminder Bot Tutorial

**Date:** January 6, 2026  
**Project:** Rocket.Chat Reminder Bot Prototype  
**Tech Stack:** TypeScript, Rocket.Chat Apps Engine, MongoDB, Docker

---

## 🎯 What We Accomplished

We built a **fully functional Rocket.Chat App** from scratch that:
- Creates reminders through an interactive modal
- Saves data to MongoDB with user associations
- Lists all user's reminders
- Sends confirmation messages via direct messages
- Handles multiple slash command arguments

---

## 📚 Key Concepts You Learned

### 1. **Rocket.Chat Apps Engine Architecture**

The Apps Engine is a framework that lets you build custom applications for Rocket.Chat. Think of it as a plugin system with strict interfaces.

```
Your App Code → Apps Engine → Rocket.Chat Server → MongoDB
```

**Key Interfaces:**
- `App` - Your main application class (extends this)
- `ISlashCommand` - Handles `/command` inputs
- `IUIKitInteractionHandler` - Processes modal submissions
- `IPersistence` - Writes to database
- `IPersistenceRead` - Reads from database

### 2. **The Modal Interaction Flow**

This is the core pattern for user interactions:

```typescript
Step 1: User types /remind
   ↓
Step 2: triggerId generated (security token)
   ↓
Step 3: openModalView() shows UI
   ↓
Step 4: User fills form and clicks Save
   ↓
Step 5: executeViewSubmitHandler() called
   ↓
Step 6: Data saved to database
   ↓
Step 7: successResponse() closes modal
```

**Why triggerId matters:**
It's a one-time security token that proves the modal request came from a real user action, preventing malicious apps from opening modals for random users.

### 3. **BlockBuilder API - Building UI**

Instead of HTML/CSS, Rocket.Chat uses a declarative block system:

```typescript
const blocks = blockBuilder
    .addInputBlock({
        blockId: 'reminder_block',      // Unique ID for this block
        label: blockBuilder.newPlainTextObject('Label text'),
        element: blockBuilder.newPlainTextInputElement({
            actionId: 'task_input',     // Unique ID for the input
            placeholder: blockBuilder.newPlainTextObject('Hint text'),
        }),
    })
    .getBlocks();
```

**The pattern:**
- `blockId` identifies the container
- `actionId` identifies the specific input field
- Access data later via: `view.state[blockId][actionId]`

### 4. **Data Persistence with Associations**

MongoDB stores data, but how do you query "all reminders for user X"? **Associations.**

```typescript
// Creating an association
const association = new RocketChatAssociationRecord(
    RocketChatAssociationModel.USER,  // Type: USER, ROOM, MESSAGE, etc.
    user.id                            // The actual user ID
);

// Save data WITH the association
await persistence.createWithAssociation(
    { task: "Buy milk", createdAt: new Date() },  // Your data
    association                                     // Link to user
);

// Later: Read all data for this user
const reminders = await read.getPersistenceReader()
    .readByAssociation(association);
```

**Why this matters:**
Without associations, you'd have to scan the entire database. With them, you get instant filtered queries.

---

## 🐛 Critical Problem We Solved

### The "Method Doesn't Exist" Error

**The Error:**
```
App triggered an interaction but it doesn't exist 
or doesn't have method executeViewSubmitHandler
```

**What Was Wrong:**
```typescript
// ❌ BROKEN - Method exists but isn't recognized
export class HelloWorldApp extends App {
    public async executeViewSubmitHandler(...) { }
}
```

**Why It Failed:**
Even though the method existed, Rocket.Chat couldn't find it because the class didn't **explicitly implement the interface**.

**The Fix:**
```typescript
// ✅ WORKS - Interface explicitly declared
export class HelloWorldApp extends App implements IUIKitInteractionHandler {
    public async executeViewSubmitHandler(...) { }
}
```

**Plus app.json:**
```json
{
    "implements": ["IUIKitInteractionHandler"]
}
```

**Lesson:** In TypeScript/Apps Engine, it's not enough for a method to exist. The class must explicitly state which interfaces it implements so the framework knows where to route requests.

---

## 🏗️ Code Structure Breakdown

### File: `HelloWorldApp.ts` (169 lines)

```typescript
// ============= IMPORTS =============
import { App } from '@rocket.chat/apps-engine/definition/App';
import { ISlashCommand, SlashCommandContext } from '...slashcommands';
import { IUIKitInteractionHandler, UIKitViewSubmitInteractionContext } from '...uikit';
import { RocketChatAssociationModel, RocketChatAssociationRecord } from '...metadata';

// ============= HELPER FUNCTIONS =============

// Opens the modal UI
async function openReminderModal(modify, triggerId, user) {
    const blockBuilder = modify.getCreator().getBlockBuilder();
    
    // Build the form
    const blocks = blockBuilder.addInputBlock({ ... }).getBlocks();
    
    // Show it to the user
    await modify.getUiController().openModalView({ ... }, { triggerId }, user);
}

// Sends a DM (private message)
async function sendDirectMessage(modify, read, user, messageText) {
    const directRoom = await read.getRoomReader().getDirectByUsernames([user.username]);
    const messageBuilder = modify.getCreator().startMessage()
        .setText(messageText)
        .setRoom(directRoom)
        .setUsernameAlias('ReminderBot');
    await modify.getCreator().finish(messageBuilder);
}

// ============= SLASH COMMAND CLASS =============

class RemindCommand implements ISlashCommand {
    public command = 'remind';
    
    public async executor(context, read, modify, http, persis) {
        const args = context.getArguments();
        
        // Route based on arguments
        if (args[0] === 'list') {
            await this.listReminders(...);
        } else if (args[0] === 'help') {
            await this.showHelp(...);
        } else {
            await openReminderModal(...);
        }
    }
    
    private async showHelp(...) { /* Shows command help */ }
    private async listReminders(...) { /* Fetches and displays reminders */ }
}

// ============= MAIN APP CLASS =============

export class HelloWorldApp extends App implements IUIKitInteractionHandler {
    
    // Registers the slash command
    public async extendConfiguration(configuration) {
        await configuration.slashCommands.provideSlashCommand(
            new RemindCommand(this)
        );
    }
    
    // Handles modal submission
    public async executeViewSubmitHandler(context, read, http, persistence, modify) {
        const data = context.getInteractionData();
        const task = data.view.state['reminder_block']['task_input'];
        
        // Save to database
        const association = new RocketChatAssociationRecord(
            RocketChatAssociationModel.USER,
            data.user.id
        );
        await persistence.createWithAssociation(
            { task, createdAt: new Date(), userId: data.user.id },
            association
        );
        
        // Send confirmation
        await sendDirectMessage(modify, read, data.user, `✅ Reminder saved: "${task}"`);
        
        // Close modal
        return context.getInteractionResponder().successResponse();
    }
}
```

---

## 🔄 Request Flow Example

Let's trace what happens when a user types `/remind`:

### 1. Command Received
```
User types: /remind
           ↓
Rocket.Chat Server receives it
           ↓
Looks up registered commands
           ↓
Finds: RemindCommand.executor()
```

### 2. Command Execution
```typescript
// In RemindCommand.executor()
const triggerId = context.getTriggerId();  // Security token generated
const sender = context.getSender();         // User object
const args = context.getArguments();        // [] (empty, no args)

// No args, so open modal
await openReminderModal(modify, triggerId, sender);
```

### 3. Modal Display
```typescript
// In openReminderModal()
const blockBuilder = modify.getCreator().getBlockBuilder();

// Build form structure
const blocks = blockBuilder.addInputBlock({
    blockId: 'reminder_block',
    element: blockBuilder.newPlainTextInputElement({
        actionId: 'task_input',
    }),
}).getBlocks();

// Show modal to user
await modify.getUiController().openModalView({
    id: 'reminder_modal',
    title: 'Create Reminder',
    blocks: blocks,
}, { triggerId }, user);
```

### 4. User Interaction
```
User sees modal → types "Buy groceries" → clicks Save
                                                ↓
                        Rocket.Chat captures form data
                                                ↓
                        Looks for handler: executeViewSubmitHandler
```

### 5. Handler Execution
```typescript
// In HelloWorldApp.executeViewSubmitHandler()
const data = context.getInteractionData();
// data.view.state = {
//     reminder_block: {
//         task_input: "Buy groceries"
//     }
// }

const task = data.view.state['reminder_block']['task_input'];
// task = "Buy groceries"
```

### 6. Database Save
```typescript
const association = new RocketChatAssociationRecord(
    RocketChatAssociationModel.USER,
    data.user.id  // e.g., "aBc123XyZ"
);

await persistence.createWithAssociation(
    {
        task: "Buy groceries",
        createdAt: Date,
        userId: "aBc123XyZ"
    },
    association
);
```

**What MongoDB sees:**
```json
{
    "_id": "generated-id-here",
    "associations": [
        { "type": "USER", "id": "aBc123XyZ" }
    ],
    "task": "Buy groceries",
    "createdAt": "2026-01-06T...",
    "userId": "aBc123XyZ"
}
```

### 7. Confirmation Sent
```typescript
await sendDirectMessage(
    modify,
    read,
    data.user,
    '✅ Reminder saved: "Buy groceries"'
);

return context.getInteractionResponder().successResponse();
// Modal closes automatically
```

---

## 🎨 The `/remind list` Command

When user types `/remind list`:

```typescript
// Step 1: Detect "list" argument
const args = context.getArguments();  // ['list']
if (args[0].toLowerCase() === 'list') {
    await this.listReminders(sender, read, modify, persis, context.getRoom());
}

// Step 2: Query database
const association = new RocketChatAssociationRecord(
    RocketChatAssociationModel.USER,
    user.id
);
const reminders = await read.getPersistenceReader().readByAssociation(association);

// Step 3: Format results
let messageText = `📋 **Your Reminders** (${reminders.length} total)\n\n`;
reminders.forEach((reminder, index) => {
    messageText += `${index + 1}. ⏳ **${reminder.task}**\n`;
});

// Step 4: Send to channel
const message = modify.getCreator().startMessage()
    .setText(messageText)
    .setRoom(room)
    .setSender(user);
await modify.getCreator().finish(message);
```

---

## 🔐 Security Concepts

### 1. **triggerId Validation**
Every modal must be triggered by a real user action. The `triggerId` proves authenticity.

### 2. **User Associations**
Data is automatically scoped to users. User A can't see User B's reminders because associations filter automatically.

### 3. **Permission Scoping**
The app only has access to its own data namespace. It can't read other apps' data or system data unless explicitly granted permissions.

---

## 🚀 Deployment Pipeline

```bash
# 1. Ensure Node v20.18.2 (compatibility requirement)
nvm use 20.18.2

# 2. Package the app (compiles TypeScript)
rc-apps package

# 3. Deploy to Rocket.Chat
rc-apps deploy --url http://localhost:3000 --username adrian --password adrian@1405 --update

# What happens:
# - TypeScript compiles to JavaScript
# - Files bundled into .zip
# - Uploaded to Rocket.Chat
# - Apps Engine loads the code
# - Slash commands registered
# - Interfaces activated
```

---

## 📊 Data Flow Diagram

```
┌─────────────┐
│    User     │
└──────┬──────┘
       │ /remind
       ▼
┌─────────────────┐
│ RemindCommand   │ ──triggerId──→ ┌──────────────┐
│  .executor()    │                │ Modal Opens  │
└─────────────────┘                └──────┬───────┘
                                          │ User fills form
                                          ▼
                        ┌─────────────────────────────────┐
                        │ executeViewSubmitHandler()      │
                        │ - Extract data from view.state  │
                        │ - Create association            │
                        │ - Save to persistence           │
                        │ - Send confirmation DM          │
                        │ - Return successResponse()      │
                        └────────┬────────────────────────┘
                                 │
                    ┌────────────┴────────────┐
                    ▼                         ▼
            ┌──────────────┐         ┌──────────────┐
            │   MongoDB    │         │   User DM    │
            │   Document   │         │  "✅ Saved"  │
            └──────────────┘         └──────────────┘
```

---

## 💡 Key Takeaways

1. **Explicit Interface Implementation is Critical**
   - Don't just write methods - declare interfaces
   - Update both code AND app.json

2. **Associations are Your Friend**
   - Always link data to users/rooms/messages
   - Makes querying fast and secure

3. **BlockBuilder is Declarative**
   - You describe structure, not appearance
   - Rocket.Chat handles rendering

4. **Read vs Write are Separate**
   - `IPersistence` for writing
   - `IPersistenceRead` for reading (via `read.getPersistenceReader()`)

5. **Debugging Apps is Different**
   - Check Docker logs: `docker logs rocketchat`
   - Use `this.getLogger().error()` for visibility
   - Apps Engine errors are cryptic - learn the patterns

---

## 🎓 What You Can Build Now

With these skills, you can create:
- ✅ Slash commands with arguments
- ✅ Interactive modals with forms
- ✅ Database persistence with user scoping
- ✅ Direct message notifications
- ✅ Command routing (help, list, etc.)

**Next level skills to learn:**
- [ ] IProcessor for scheduled jobs
- [ ] Date/time pickers in modals
- [ ] Button actions in messages
- [ ] Settings pages
- [ ] API endpoints

---

## 📖 Resources

- **Apps Engine Docs:** https://developer.rocket.chat/apps-engine
- **Your Working Code:** `C:\Users\karti\Downloads\helloworld\HelloWorldApp.ts`
- **TypeScript Types:** Check `node_modules/@rocket.chat/apps-engine/definition/`

---

**You built this in one day!** That's impressive. Most developers take a week to get their first Rocket.Chat app working. 🚀
