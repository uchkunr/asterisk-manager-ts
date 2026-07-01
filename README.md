# asterisk-manager-ts

A modern, fully-typed TypeScript library for interacting with the **Asterisk Manager Interface (AMI)**.

## Features

- **TypeScript Native:** Fully typed API, making it easy to see expected structures.
- **Robust Parsing:** Built-in TCP stream parser that handles packets split across chunks, duplicate headers, and multi-line raw output (e.g. command response output).
- **Flexible Callbacks & Promises:** Supports both standard async/await Promises and traditional Node.js style callbacks for action triggers.
- **Automatic Reconnection:** Option to auto-reconnect if the socket connection is dropped.

## Getting Started

### Installation

First, install dependencies:

```bash
npm install
```

### Build the Package

To compile the TypeScript code into JavaScript:

```bash
npm run build
```

The compiled output will be generated inside the `dist/` directory.

### Run Tests

To run the unit tests:

```bash
npm run test
```

## Usage Example

Here is a quick example of how to import and use the library:

```typescript
import { AsteriskManager } from 'asterisk-manager-ts';

// Initialize the manager
const ami = new AsteriskManager(5038, 'localhost', 'admin', 'secret', true);

// Register event listeners
ami.on('connect', () => {
  console.log('Connected to Asterisk AMI TCP Socket');
});

ami.on('ready', () => {
  console.log('Successfully authenticated and logged in!');

  // Send an AMI action using Promise style
  ami.action({ Action: 'Ping' })
    .then((res) => console.log('Ping Response:', res))
    .catch((err) => console.error('Ping Error:', err));
});

ami.on('managerevent', (evt) => {
  console.log('Received general event:', evt.Event);
});

ami.on('peerstatus', (evt) => {
  console.log(`Peer status update: ${evt.Peer} is now ${evt.PeerStatus}`);
});

ami.on('error', (err) => {
  console.error('AMI Client Error:', err);
});

// Establish connection
ami.connect();
```

## Project Structure

```
asterisk-manager-ts/
├── src/
│   ├── __tests__/         # Unit tests (Vitest)
│   │   └── parser.test.ts
│   ├── index.ts           # Main entry point (exports client and types)
│   ├── manager.ts         # AsteriskManager class implementation
│   ├── parser.ts          # AmiParser class implementation (handles TCP packet streams)
│   └── types.ts           # TypeScript interfaces for AMI Actions, Responses, and Events
├── package.json           # Scripts, dependencies, and metadata
├── tsconfig.json          # TypeScript compilation options
└── .gitignore             # Ignored directories/files
```