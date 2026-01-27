# Rocket.Chat Reminder App

A practical reminder bot for Rocket.Chat that helps you manage tasks and schedule notifications. Built as part of my GSoC 2026 learning journey with the Rocket.Chat Apps Engine.

## What It Does

This app lets you create and manage reminders directly within Rocket.Chat. You can save reminders for later, schedule delayed notifications, and keep track of all your tasks in one place.

### Features

- **Quick Reminders** - Save tasks instantly using an interactive modal
- **Scheduled Notifications** - Test the scheduler with 10-second delayed reminders
- **Recurring Reminders** - Set up reminders that repeat every minute (cron jobs)
- **Task Management** - View all your saved reminders in a clean list
- **Bulk Actions** - Clear all reminders with a single command
- **Background Jobs** - Demonstrates scheduler functionality for time-based tasks

## Commands

```
/remind                    - Open a form to create a new reminder
/remind schedule [task]    - Get a reminder in 10 seconds (scheduler demo)
/remind recur [task]       - Start a recurring reminder (fires every minute)
/remind stop               - Stop your recurring reminder
/remind list               - See all your saved reminders
/remind clear              - Delete all your reminders
/remind help               - Show command reference
```

## How to Use

1. Type `/remind` in any channel to create a reminder
2. Fill in the task details and click Save
3. Use `/remind list` to view all your reminders anytime
4. Try `/remind schedule Test task` to see the background scheduler in action
5. Use `/remind recur Take a break` to get nagged every minute until you run `/remind stop`

## Development Setup

If you want to run this locally or contribute:

### Prerequisites
- Node.js (v14 or higher)
- A Rocket.Chat server instance running locally
- Rocket.Chat Apps CLI installed globally

### Installation

```bash
# Clone the repository
git clone https://github.com/adrianYT028/rocket_chat_app.git
cd rocket_chat_app

# Install dependencies
npm install

# Package the app
rc-apps package

# Deploy to your local server
rc-apps deploy --url http://localhost:3000 --username YOUR_USERNAME --password YOUR_PASSWORD
```

### Project Structure

```
├── HelloWorldApp.ts    # Main app logic and scheduler processor
├── app.json           # App metadata and configuration
├── package.json       # Dependencies
└── tsconfig.json      # TypeScript settings
```

## Technical Details

This app showcases several key concepts:

- **Slash Commands** - Custom command handling with argument parsing
- **UI Kit** - Modal forms for user input
- **Persistence** - Storing user data with associations
- **Scheduler** - Background job processing for delayed and recurring tasks
- **Cron Jobs** - Recurring reminders using cron expressions (`* * * * *`)
- **Direct Messaging** - Sending private confirmations to users

The scheduler implementation proves the app can handle both one-time and recurring time-based background jobs, which is essential for building a full-featured reminder system.

## What I Learned

Building this taught me how to work with the Rocket.Chat Apps Engine, including:
- How slash commands are processed and routed
- Managing app state using the persistence API
- Scheduling background jobs that execute after a delay
- Implementing recurring tasks with cron expressions
- Job lifecycle management (create, execute, cancel)
- Creating interactive forms with UIKit blocks
- Handling user interactions and responses

## Future Ideas

Some features I'm thinking about adding:
- Custom time intervals (5 minutes, 1 hour, daily, weekly)
- Specific date/time scheduling (e.g., "remind me on Friday at 3pm")
- Customizable recurring patterns (every 30 minutes, hourly, daily)
- Reminder notifications in DMs
- Mark reminders as complete
- Edit existing reminders
- Snooze functionality

## Resources

- [Apps Engine Documentation](https://rocketchat.github.io/Rocket.Chat.Apps-engine/)
- [Apps Engine GitHub](https://github.com/RocketChat/Rocket.Chat.Apps-engine)
- [Rocket.Chat Developer Docs](https://developer.rocket.chat/)

## License

This project is open source and available for anyone to use and learn from.

---

Built with ☕ by Kartik as part of GSoC 2026 preparation
