import type { AmiEvent } from './types.js';

/**
 * Types for common events, taken from the Asterisk source (manager_channels.c,
 * manager_bridges.c, stasis_endpoints.c, app_queue.c, manager.c).
 * Every value is a string, as on the wire. Asterisk may add headers in later
 * versions; unknown headers are still present on the object.
 */

type Prefixed<P extends string, T> = { readonly [K in keyof T as `${P}${K & string}`]: T[K] };

/** Headers Asterisk adds to every channel-oriented event. */
export interface ChannelFields {
  readonly Channel: string;
  readonly ChannelState: string;
  readonly ChannelStateDesc: string;
  readonly CallerIDNum: string;
  readonly CallerIDName: string;
  readonly ConnectedLineNum: string;
  readonly ConnectedLineName: string;
  readonly Language: string;
  readonly AccountCode: string;
  readonly Context: string;
  readonly Exten: string;
  readonly Priority: string;
  readonly Uniqueid: string;
  readonly Linkedid: string;
  readonly Tenantid?: string;
}

/** The second channel in dial, queue and agent events. */
export type DestChannelFields = Prefixed<'Dest', ChannelFields>;

export interface BridgeFields {
  readonly BridgeUniqueid: string;
  readonly BridgeType: string;
  readonly BridgeTechnology: string;
  readonly BridgeCreator: string;
  readonly BridgeName: string;
  readonly BridgeNumChannels: string;
  readonly BridgeVideoSourceMode?: string;
  readonly BridgeVideoSource?: string;
}

export interface FullyBootedEvent extends AmiEvent {
  readonly Event: 'FullyBooted';
  readonly Uptime: string;
  readonly LastReload: string;
  readonly Status: string;
}

export interface NewchannelEvent extends AmiEvent, ChannelFields {
  readonly Event: 'Newchannel';
}

export interface NewstateEvent extends AmiEvent, ChannelFields {
  readonly Event: 'Newstate';
}

export interface HangupEvent extends AmiEvent, ChannelFields {
  readonly Event: 'Hangup';
  /** Q.850 cause code, e.g. `16` normal clearing, `17` busy, `19` no answer. */
  readonly Cause: string;
  readonly 'Cause-txt': string;
  /** Technology cause, e.g. the SIP status code. Asterisk 20.17, 22.7, 23.1 and later. */
  readonly TechCause?: string;
}

export interface HangupRequestEvent extends AmiEvent, ChannelFields {
  readonly Event: 'HangupRequest' | 'SoftHangupRequest';
  readonly Cause?: string;
  readonly TechCause?: string;
}

/** Emitted as `Newexten` (the Asterisk documentation spells it `NewExten`). */
export interface NewextenEvent extends AmiEvent, ChannelFields {
  readonly Event: 'Newexten';
  readonly Extension: string;
  readonly Application: string;
  readonly AppData: string;
}

export interface VarSetEvent extends AmiEvent, ChannelFields {
  readonly Event: 'VarSet';
  readonly Variable: string;
  readonly Value: string;
}

export interface DialBeginEvent extends AmiEvent, Partial<ChannelFields>, DestChannelFields {
  readonly Event: 'DialBegin';
  readonly DialString?: string;
}

export interface DialEndEvent extends AmiEvent, Partial<ChannelFields>, DestChannelFields {
  readonly Event: 'DialEnd';
  readonly DialStatus:
    | 'ABORT'
    | 'ANSWER'
    | 'BUSY'
    | 'CANCEL'
    | 'CHANUNAVAIL'
    | 'CONGESTION'
    | 'CONTINUE'
    | 'GOTO'
    | 'NOANSWER'
    | (string & {});
  readonly Forward?: string;
}

export interface BridgeEnterEvent extends AmiEvent, ChannelFields, BridgeFields {
  readonly Event: 'BridgeEnter';
  readonly SwapUniqueid?: string;
}

export interface BridgeLeaveEvent extends AmiEvent, ChannelFields, BridgeFields {
  readonly Event: 'BridgeLeave';
}

export interface BridgeCreateEvent extends AmiEvent, BridgeFields {
  readonly Event: 'BridgeCreate' | 'BridgeDestroy';
}

export interface DTMFEvent extends AmiEvent, ChannelFields {
  readonly Event: 'DTMFBegin' | 'DTMFEnd';
  readonly Digit: string;
  readonly Direction: 'Received' | 'Sent' | (string & {});
  /** Only on DTMFEnd. */
  readonly DurationMs?: string;
}

export interface HoldEvent extends AmiEvent, ChannelFields {
  readonly Event: 'Hold' | 'Unhold';
  readonly MusicClass?: string;
}

export interface DeviceStateChangeEvent extends AmiEvent {
  readonly Event: 'DeviceStateChange';
  readonly Device: string;
  readonly State: string;
}

export interface PeerStatusEvent extends AmiEvent {
  readonly Event: 'PeerStatus';
  readonly ChannelType: string;
  /** `Tech/name`, e.g. `PJSIP/101`. */
  readonly Peer: string;
  readonly PeerStatus: string;
  readonly Cause?: string;
  readonly Address?: string;
  readonly Port?: string;
  readonly Time?: string;
}

export interface ContactStatusEvent extends AmiEvent {
  readonly Event: 'ContactStatus';
  readonly URI: string;
  readonly ContactStatus:
    | 'Unknown'
    | 'Unreachable'
    | 'Reachable'
    | 'Unqualified'
    | 'Removed'
    | 'Updated'
    | (string & {});
  readonly AOR: string;
  readonly EndpointName: string;
  readonly RoundtripUsec?: string;
}

/**
 * Result of an `Originate` with `Async: true`. Carries the ActionID of the
 * Originate action. `Reason` is the last control frame: `0` failed,
 * `1` hung up, `3` ringing (no answer), `4` answered, `5` busy, `8` congestion.
 */
export interface OriginateResponseEvent extends AmiEvent {
  readonly Event: 'OriginateResponse';
  readonly Response: 'Success' | 'Failure';
  readonly Channel: string;
  readonly Reason: string;
  readonly Uniqueid: string;
  readonly CallerIDNum: string;
  readonly CallerIDName: string;
  readonly Context?: string;
  readonly Exten?: string;
  readonly Application?: string;
  readonly Data?: string;
}

export interface UserEventEvent extends AmiEvent {
  readonly Event: 'UserEvent';
  readonly UserEvent: string;
}

export interface QueueCallerJoinEvent extends AmiEvent, ChannelFields {
  readonly Event: 'QueueCallerJoin';
  readonly Queue: string;
  readonly Position: string;
  readonly Count: string;
}

export interface QueueCallerLeaveEvent extends AmiEvent, ChannelFields {
  readonly Event: 'QueueCallerLeave';
  readonly Queue: string;
  readonly Position: string;
  readonly Count: string;
}

export interface QueueCallerAbandonEvent extends AmiEvent, ChannelFields {
  readonly Event: 'QueueCallerAbandon';
  readonly Queue: string;
  readonly Position: string;
  readonly OriginalPosition: string;
  readonly HoldTime: string;
}

export interface QueueMemberStatusEvent extends AmiEvent {
  readonly Event: 'QueueMemberStatus';
  readonly Queue: string;
  readonly MemberName: string;
  readonly Interface: string;
  readonly StateInterface: string;
  readonly Membership: 'dynamic' | 'realtime' | 'static' | (string & {});
  readonly Penalty: string;
  readonly CallsTaken: string;
  readonly LastCall: string;
  readonly LastPause: string;
  readonly LoginTime?: string;
  readonly InCall: string;
  /** Device state: 0 unknown, 1 not in use, 2 in use, 3 busy, 4 invalid, 5 unavailable, 6 ringing, 7 ring in use, 8 on hold. */
  readonly Status: string;
  readonly Paused: string;
  readonly PausedReason?: string;
  readonly Ringinuse: string;
  readonly Wrapuptime?: string;
}

interface AgentFields extends ChannelFields, Partial<DestChannelFields> {
  readonly Queue: string;
  readonly MemberName: string;
  readonly Interface: string;
}

export interface AgentCalledEvent extends AmiEvent, AgentFields {
  readonly Event: 'AgentCalled';
}

export interface AgentConnectEvent extends AmiEvent, AgentFields {
  readonly Event: 'AgentConnect';
  readonly HoldTime: string;
  readonly RingTime: string;
}

export interface AgentCompleteEvent extends AmiEvent, AgentFields {
  readonly Event: 'AgentComplete';
  readonly HoldTime: string;
  readonly TalkTime: string;
  readonly Reason: 'caller' | 'agent' | 'transfer' | (string & {});
}

export interface AgentRingNoAnswerEvent extends AmiEvent, AgentFields {
  readonly Event: 'AgentRingNoAnswer';
  readonly RingTime: string;
}

/** Item of `CoreShowChannels`. */
export interface CoreShowChannelEvent extends AmiEvent, ChannelFields {
  readonly Event: 'CoreShowChannel';
  readonly Application: string;
  readonly ApplicationData: string;
  readonly Duration: string;
  readonly BridgeId: string;
}

/** Event names with a known shape. Any other name gives a plain `AmiEvent`. */
export interface KnownEvents {
  FullyBooted: FullyBootedEvent;
  Newchannel: NewchannelEvent;
  Newstate: NewstateEvent;
  Hangup: HangupEvent;
  HangupRequest: HangupRequestEvent;
  SoftHangupRequest: HangupRequestEvent;
  Newexten: NewextenEvent;
  VarSet: VarSetEvent;
  DialBegin: DialBeginEvent;
  DialEnd: DialEndEvent;
  BridgeCreate: BridgeCreateEvent;
  BridgeDestroy: BridgeCreateEvent;
  BridgeEnter: BridgeEnterEvent;
  BridgeLeave: BridgeLeaveEvent;
  DTMFBegin: DTMFEvent;
  DTMFEnd: DTMFEvent;
  Hold: HoldEvent;
  Unhold: HoldEvent;
  DeviceStateChange: DeviceStateChangeEvent;
  PeerStatus: PeerStatusEvent;
  ContactStatus: ContactStatusEvent;
  OriginateResponse: OriginateResponseEvent;
  UserEvent: UserEventEvent;
  QueueCallerJoin: QueueCallerJoinEvent;
  QueueCallerLeave: QueueCallerLeaveEvent;
  QueueCallerAbandon: QueueCallerAbandonEvent;
  QueueMemberStatus: QueueMemberStatusEvent;
  AgentCalled: AgentCalledEvent;
  AgentConnect: AgentConnectEvent;
  AgentComplete: AgentCompleteEvent;
  AgentRingNoAnswer: AgentRingNoAnswerEvent;
  CoreShowChannel: CoreShowChannelEvent;
}
