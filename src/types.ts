export interface AmiAction {
  Action: string;
  ActionID?: string;
  [key: string]: any;
}

export interface AmiResponse {
  Response: 'Success' | 'Error' | 'Follows' | string;
  ActionID?: string;
  Message?: string;
  [key: string]: any;
}

export interface AmiEvent {
  Event: string;
  Privilege?: string;
  [key: string]: any;
}

export interface AsteriskManagerOptions {
  port?: number;
  host?: string;
  username?: string;
  password?: string;
  reconnect?: boolean;
  reconnectInterval?: number; // in milliseconds
}
