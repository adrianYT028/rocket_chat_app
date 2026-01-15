# GSoC 2026 Proposal: Rocket.Chat Reminder Bot - Kartik Bhat

---

## 1. Abstract

I'm proposing to build a Reminder Bot for Rocket.Chat that helps teams stay on top of their tasks without leaving the platform. Users will be able to create and manage reminders through simple slash commands, with notifications delivered privately via direct messages rather than cluttering public channels. The implementation will use the Rocket.Chat Apps Engine framework, taking advantage of its modal UI system for user interactions and built-in persistence layer for storing reminder data.

The bot will support:
- Creating reminders through an interactive modal interface
- Private notification delivery to keep channels focused
- Persistent storage of reminder information
- Automated scheduling to send reminders at the right time

---

## 2. The Problem

### 2.1 Why This Matters
Teams today spend most of their day in chat platforms like Rocket.Chat. It's where discussions happen, decisions get made, and work gets coordinated. But there's a problem: important tasks and action items get lost in the conversation flow. Someone mentions "let's follow up on this tomorrow," and by tomorrow, it's already buried under fifty new messages. This leads to missed deadlines and forgotten commitments.

### 2.2 What's Missing Right Now
Currently, if you want to set a reminder while working in Rocket.Chat, you have to switch to a separate app. Maybe you open your phone's reminder app, or a todo list manager, or even just write it down on paper. This context switching breaks your workflow and honestly, most people just don't bother. They rely on memory, which doesn't always work out.

Some teams try using external reminder bots, but these tend to blast notifications into public channels, which creates noise and annoys everyone. There's no good way to get personal reminders without disrupting the whole team. Rocket.Chat doesn't currently have a built-in solution that respects privacy while keeping everything in one place.

### 2.3 What Would Change
Imagine being able to type `/remind` right in your Rocket.Chat window, set a reminder in seconds, and get a private notification when it's time. No app switching, no channel spam, no forgotten tasks. That's what this project aims to deliver.

---

## 3. Proposed Solution

### 3.1 What I'm Building
I want to create a Rocket.Chat App that gives users a complete reminder system without leaving their workspace. The core idea is simple: type a command, fill out a quick form, and get reminded when you need to be. The implementation will use the Apps Engine's modal interface for a clean user experience and its persistence system to store reminders reliably.

### 3.2 How It Works
Here's the flow I've designed: You type `/remind` in any channel or direct message. A modal window pops up asking what you want to be reminded about and when. You fill in the details and hit save. The reminder gets stored in the database. When the time comes, the bot sends you a private direct message with your reminder. You can also list your active reminders or delete ones you don't need anymore through additional commands.

### 3.3 Why This Approach Makes Sense
First, privacy matters. By sending reminders via direct messages instead of broadcasting them to channels, users can set personal reminders without worrying about what their teammates see. Second, it's completely self-contained within Rocket.Chat, so there's no need to sign up for external services or manage API keys. Third, the modal interface means users don't need to remember complex command syntax. Just click and type.

---

## 4. Technical Implementation

### 4.1 How Everything Fits Together

I've structured the application around the Rocket.Chat Apps Engine framework. Here's how the different pieces connect:

```
┌─────────────────────────────────────────────┐
│           Rocket.Chat Client                │
│  (User triggers /remind slash command)      │
└────────────────┬────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────┐
│         Apps Engine Framework               │
│  ┌─────────────────────────────────────┐   │
│  │  HelloWorldApp (Main Entry Point)   │   │
│  │  - extendConfiguration()            │   │
│  │  - executeViewSubmitHandler()       │   │
│  └─────────────────────────────────────┘   │
│  ┌─────────────────────────────────────┐   │
│  │  Slash Command Handler (/remind)    │   │
│  └─────────────────────────────────────┘   │
│  ┌─────────────────────────────────────┐   │
│  │  Modal UI (BlockBuilder)            │   │
│  └─────────────────────────────────────┘   │
│  ┌─────────────────────────────────────┐   │
│  │  Persistence Layer (IPersistence)   │   │
│  └─────────────────────────────────────┘   │
│  ┌─────────────────────────────────────┐   │
│  │  Scheduler (Processor API)          │   │
│  └─────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────┐
│         Rocket.Chat Database                │
│  (MongoDB - Stores reminder records)        │
└─────────────────────────────────────────────┘
```

### 4.2 Handling User Interactions

For managing user inputs, I'm using the IUIKitInteractionHandler interface that comes with the Apps Engine. I've already built a working prototype that demonstrates the entire flow:

#### 4.2.1 Trigger Phase
A slash command (`/remind`) initiates the interaction flow:

```typescript
class RemindCommand implements ISlashCommand {
    public command = 'remind';
    
    public async executor(context: SlashCommandContext, read: any, modify: any): Promise<void> {
        const triggerId = context.getTriggerId();
        const sender = context.getSender();
        
        if (triggerId) {
            await openReminderModal(modify, triggerId, sender);
        }
    }
}
```

The triggerId is important here because it's a security token that proves this modal request came from a legitimate user interaction. Without it, anyone could potentially open modals for other users, which would be a security problem.

#### 4.2.2 View Rendering Phase
A modal is rendered using **BlockBuilder** API, containing input blocks with unique `actionIds`:

```typescript
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
```

**Screenshot: Reminder Modal in Action**
```
┌──────────────────────────────────────┐
│        Create Reminder          [×]  │
├──────────────────────────────────────┤
│                                      │
│  What would you like to be           │
│  reminded about?                     │
│  ┌────────────────────────────────┐ │
│  │ Enter task description...      │ │
│  └────────────────────────────────┘ │
│                                      │
│                    [Cancel]  [Save]  │
└──────────────────────────────────────┘
```

#### 4.2.3 Action Processing Phase
Upon submission, `executeViewSubmitHandler` captures `view.state` and processes the data:

```typescript
public async executeViewSubmitHandler(
    context: UIKitViewSubmitInteractionContext,
    read: IRead,
    http: IHttp,
    persistence: IPersistence,
    modify: IModify,
) {
    const interactionData = context.getInteractionData();
    const viewState = interactionData.view.state as any;
    const taskDescription = viewState['reminder_block']['task_input'];
    const user = interactionData.user;
    
    // Store reminder and send confirmation
    await sendDirectMessage(modify, read, user, 'Reminder set: ' + taskDescription);
    
    return context.getInteractionResponder().successResponse();
}
```

### 4.3 Sending Private Notifications

One thing I learned while building the prototype is how important it is to deliver reminders privately. Nobody wants their personal tasks broadcast to the entire team, and channels shouldn't be filled with notification noise. The solution is to send reminders via direct messages.

```typescript
async function sendDirectMessage(
    modify: IModify, 
    read: IRead, 
    user: any, 
    messageText: string
): Promise<void> {
    // 1. Get the Direct Room between Bot and User
    const directRoom = await read.getRoomReader().getDirectByUsernames([
        user.username,
        // Bot username is automatically handled
    ]);
    
    // 2. Send message to THAT room only
    if (directRoom) {
        const messageBuilder = modify.getCreator().startMessage()
            .setText(messageText)
            .setRoom(directRoom)  // <--- Privacy-respecting delivery
            .setUsernameAlias('ReminderBot');
        
        await modify.getCreator().finish(messageBuilder);
    }
}
```

This approach keeps public channels clean and focused on actual team discussions, while users get their reminders privately without broadcasting potentially sensitive information to everyone.

### 4.4 Data Persistence

Reminders are stored using the **IPersistence** accessor with the following structure:

```typescript
interface ReminderRecord {
    userId: string;           // "User_ID"
    username: string;         // "kartik.bhat"
    task: string;             // "Drink Water"
    scheduledTime: string;    // ISO 8601: "2026-01-02T10:00:00Z"
    createdAt: string;        // Timestamp of creation
    status: 'pending' | 'completed' | 'cancelled';
}
```

**Implementation:**

```typescript
// Storing a reminder
const reminderData: ReminderRecord = {
    userId: user.id,
    username: user.username,
    task: taskDescription,
    scheduledTime: reminderTime.toISOString(),
    createdAt: new Date().toISOString(),
    status: 'pending'
};

await persistence.createWithAssociation(
    reminderData,
    new RocketChatAssociationRecord(
        RocketChatAssociationModel.USER,
        user.id
    )
);
```

**Retrieval Pattern:**

```typescript
// Fetch all reminders for a user
const associations = [
    new RocketChatAssociationRecord(
        RocketChatAssociationModel.USER,
        user.id
    )
];

const reminders = await persistence.readByAssociations(associations);
```

### 4.5 Running Background Jobs

For the scheduling system, I'll implement the IProcessor interface, which lets the app run background tasks at regular intervals:

```typescript
export class HelloWorldApp extends App implements IProcessor {
    // Runs every minute
    public async processor(
        jobContext: IJobContext,
        read: IRead,
        modify: IModify,
        http: IHttp,
        persis: IPersistence
    ): Promise<void> {
        const now = new Date();
        
        // Fetch all pending reminders due now
        const dueReminders = await this.getDueReminders(read, persis, now);
        
        for (const reminder of dueReminders) {
            // Send DM to user
            await this.sendReminderNotification(modify, read, reminder);
            
            // Mark as completed
            await this.updateReminderStatus(persis, reminder.id, 'completed');
        }
    }
}
```

### 4.6 Additional Commands (Future Extensions)

| Command | Purpose | Implementation |
|---------|---------|----------------|
| `/remind list` | View all active reminders | Query persistence by user association |
| `/remind delete <id>` | Cancel a reminder | Update status to 'cancelled' |
| `/remind edit <id>` | Modify existing reminder | Fetch → Modify → Update |

---

## 5. Timeline (12 Weeks)

### Community Bonding (May 1 - 26)
During the first few weeks, I'll spend time going deeper into the Apps Engine documentation to understand the nuances I haven't encountered yet. I'll also make sure my development environment is properly configured and spend time discussing the architecture details with mentors to make sure we're aligned on the approach. This is also when I'll finalize any technical specifications based on mentor feedback.

### Phase 1: Core Functionality (May 27 - June 30)
The first phase focuses on getting the basic reminder creation and delivery working. In weeks 1-2, I'll implement the `/remind` command with the modal interface, making sure to handle edge cases and validate user input properly. I'll write tests to ensure the interaction handlers work correctly.

Weeks 3-4 are about building out the persistence layer. This involves figuring out the best way to store reminders, how to retrieve them efficiently, and ensuring data is properly associated with the right users.

By week 5, I'll have the direct message notification system working and will test it with multiple users to make sure everything behaves correctly. At the end of this phase, I should have a working prototype that can create reminders and send notifications.

### Phase 2: Scheduler & Management (July 1 - July 28)
Phase 2 is about making the system more robust and user-friendly. In weeks 6-7, I'll implement the background processor that checks for due reminders and sends them out. I also want to add support for natural language time parsing (like "tomorrow at 3pm" or "in 2 hours") and make sure timezones are handled correctly.

Weeks 8-9 will focus on reminder management features. Users need to be able to see their active reminders, delete ones they no longer need, and edit existing reminders if plans change.

Week 10 is buffer time for thorough testing and fixing any bugs that come up. By the end of this phase, I'll have a complete reminder management system that handles the full lifecycle from creation to deletion.

### Phase 3: Polish & Documentation (July 29 - August 25)
The final phase is about making the app production-ready. Week 11 will be dedicated to documentation because good documentation is what separates hobby projects from real tools. I'll write user guides, developer documentation for anyone who wants to contribute later, and add support for multiple languages if time permits.

Week 12 is for optimization and final polish. I'll profile the code to find performance bottlenecks, do a final round of testing, and create a demo video showing the app in action. I'll also write a blog post about the development process to help others who might want to build similar apps.

---

## 6. Contributions

### Current Work-in-Progress

**HelloWorld Reminder Bot Prototype**
- Repository: [Link to your GitHub repo]
- Status: Working prototype running on my local machine
- What's working so far:
  - The `/remind` slash command is registered and responding
  - Modal interface built with BlockBuilder is functional
  - View submission handler processes user input correctly
  - Direct message delivery is working
  - Basic persistence integration is in place
  
**Code Samples:**
- HelloWorldApp.ts contains the main application logic
- Deployment documentation shows how I got it running

### What I Plan to Contribute

Beyond just building this app, I want to give back to the Rocket.Chat community. Once the reminder bot is complete, I'll submit it to the Apps Marketplace so others can use it. If I find any bugs or issues in the Apps Engine during development, I'll document them and submit fixes where I can.

I also want to write a tutorial about building apps with scheduled notifications, since that seems to be something many developers struggle with. And I'll stay active in the community forums to help other developers who are working on similar projects.

---

## 7. About Me

### Personal Information
- **Name:** Kartik Bhat
- **Email:** [Your Email]
- **GitHub:** [Your GitHub Profile]
- **LinkedIn:** [Your LinkedIn]
- **Location:** [Your Location]
- **Time Zone:** [Your Timezone]

### Technical Background

I'm most comfortable with TypeScript and JavaScript, which is perfect for this project. I also have experience with Python and Java, though I use them less frequently. For relevant technologies, I've worked with Node.js extensively, used MongoDB in several projects, and have a solid understanding of RESTful API design. Git is my daily driver for version control.

Some projects I've worked on include:
- [Project 1]: Brief description and link
- [Project 2]: Brief description and link
- [Project 3]: Brief description and link

### Why This Project and Why Me

I think what sets me apart is that I've already proven I can work with this codebase. Just two days ago, I had never touched Rocket.Chat's code. Now I have a working app that handles slash commands, renders modals, processes user input, and sends direct messages. That rapid progress shows I can learn quickly, figure things out independently, and turn documentation into actual working code.

I'm genuinely interested in this project because I believe in what Rocket.Chat stands for. Privacy-respecting communication tools matter, especially as more companies look for alternatives to proprietary platforms. Building tools that help teams work more effectively while respecting their privacy is exactly the kind of work I want to be doing.

As for availability, I can commit 40+ hours per week to GSoC during the summer. I don't have other internships or major commitments lined up for Summer 2026, so this will be my primary focus.

### How I Communicate

I'm comfortable with regular check-ins and transparent communication. I can send daily progress updates through Rocket.Chat, and I'm happy to do weekly video calls with mentors to discuss blockers or design decisions. I also like the idea of blogging publicly about the development process because it forces me to think clearly about what I'm doing and helps others learn.

You can reach me at: [Rocket.Chat username or email]

---

## 8. Wrapping Up

I believe this reminder bot would be a valuable addition to Rocket.Chat, and I know I have the skills to build it well. The prototype I've already created demonstrates that I understand the Apps Engine architecture and can translate ideas into working code. More importantly, I'm excited about this project and committed to seeing it through to completion.

I appreciate you taking the time to review this proposal, and I hope to get the opportunity to contribute to Rocket.Chat this summer.

---

**Appendix A: References**
- Rocket.Chat Apps Engine Documentation: https://developer.rocket.chat/apps-engine
- My Development Blog: [Link]
- Working Prototype Demo: [YouTube/Recording Link]

**Appendix B: Risk Mitigation**
- **Risk:** Scheduler not firing reliably → **Mitigation:** Use Apps Engine's proven processor patterns, add redundancy checks
- **Risk:** Data persistence failures → **Mitigation:** Implement comprehensive error handling and transaction rollbacks
- **Risk:** Time zone complexities → **Mitigation:** Use industry-standard libraries (e.g., date-fns-tz), extensive testing

---

*Last Updated: January 6, 2026*
