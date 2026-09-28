import { decodeInput, newer, type InputFrame } from '../../engine/protocol.ts';
import type { Channel, Message } from '../../engine/messages.ts';
import type { Identity, Roster } from '../../../shared/room.ts';
import type { Point } from '../../../core/types.ts';

type RoutingIdentity = Pick<Identity, 'id' | 'role' | 'hostId' | 'venueId'>;
export type ControllerRoute = 'venue' | 'direct-to-session';
export interface RoutingEnvironment {
  localTime(): number;
  authorityTime(): number;
  /** Schedule after the current stack; callbacks may still run after retirement. */
  defer(callback: () => void): void;
}
export interface RoutingEffects {
  send(to: string, channel: Channel, data: Message | ArrayBuffer): void;
  authorityInput(playerId: string, data: ArrayBuffer): void;
  authorityControl(from: string, message: Message): void;
  display(channel: Channel, message: Message): void;
  controller(message: Message): void;
}
/** Session routing policy; transport and application lifecycle remain external. */
export class SessionRouter {
  private identity: RoutingIdentity | null = null;
  private roster: Roster = { players: [], venues: [] };
  private controllerPath: ControllerRoute = 'venue';
  private active = false;
  private terminal = false;
  private epoch = 0;
  private localCursors = new Map<
    string,
    { point: Point; at: number; color: string; name: string }
  >();
  // Cursor admission mirrors the local phone's config/ACK and binary ordering.
  // Remote venues observe the same trusted config as they relay it to the phone.
  private cursorInputs = new Map<
    string,
    { generation: number; ready: boolean; seq: number | null }
  >();
  constructor(
    private readonly environment: RoutingEnvironment,
    private readonly effects: RoutingEffects,
  ) {}
  welcome(identity: RoutingIdentity) {
    if (this.terminal) return;
    this.disconnect();
    this.identity = {
      id: identity.id,
      role: identity.role,
      hostId: identity.hostId,
      venueId: identity.venueId,
    };
    this.active = true;
  }
  setRoster(roster: Roster) {
    if (this.terminal) return;
    this.roster = structuredClone(roster);
    for (const id of this.cursorInputs.keys())
      if (
        !roster.players.some(
          (player) =>
            player.id === id &&
            player.connected &&
            player.venueId === this.identity?.id,
        )
      ) {
        this.cursorInputs.delete(id);
        this.localCursors.delete(id);
      }
  }
  setControllerRoute(route: ControllerRoute) {
    if (!this.terminal) this.controllerPath = route;
  }
  sendFrame(data: ArrayBuffer) {
    const me = this.identity;
    if (!this.active || this.terminal || me?.role !== 'controller') return;
    this.effects.send(
      this.controllerPath === 'direct-to-session' ? me.hostId : me.venueId,
      'input',
      data,
    );
  }
  disconnect() {
    this.active = false;
    this.epoch++;
    this.clearLocalCursors();
  }
  end() {
    if (this.terminal) return;
    this.disconnect();
    this.terminal = true;
  }
  dispose() {
    this.end();
  }
  toVenue(id: string, channel: Channel, msg: Message) {
    if (!this.active || this.terminal || !this.identity) return;
    if (id === this.identity.id) {
      const epoch = this.epoch;
      const copy = structuredClone(msg);
      this.environment.defer(() => {
        if (this.active && !this.terminal && epoch === this.epoch)
          this.effects.display(channel, copy);
      });
    } else this.effects.send(id, channel, msg);
  }
  toPlayer(id: string, message: Message) {
    if (!this.active || this.terminal || !this.identity) return;
    const p = this.roster.players.find((p) => p.id === id);
    if (!p) return;
    if (p.venueId === this.identity?.id) {
      this.cursorConfig(id, message);
      this.effects.send(id, 'ctrl', message);
    } else
      this.effects.send(p.venueId, 'ctrl', {
        type: 'toController',
        target: id,
        message,
      });
  }
  sendUp(message: Message) {
    const me = this.identity;
    if (!this.active || !me || this.terminal) return;
    if (me.role === 'host') this.effects.authorityControl(me.id, message);
    else if (me.role === 'display')
      this.effects.send(me.hostId, 'ctrl', message);
    else
      this.effects.send(
        this.controllerPath === 'direct-to-session' ? me.hostId : me.venueId,
        'ctrl',
        message,
      );
  }
  receive(from: string, channel: Channel, raw: Message | ArrayBuffer) {
    if (
      !(raw instanceof ArrayBuffer) &&
      (!raw || typeof raw !== 'object' || typeof raw.type !== 'string')
    )
      return;
    const data = raw as Message;
    const me = this.identity;
    if (!this.active || this.terminal || !me) return;
    if (me.role === 'controller') {
      if (channel === 'ctrl' && (from === me.venueId || from === me.hostId))
        this.effects.controller(data);
      return;
    }
    const player = this.roster.players.find(
      (p) => p.id === from && (p.venueId === me.id || me.role === 'host'),
    );
    if (player) {
      if (channel === 'input' && data instanceof ArrayBuffer) {
        let frame: InputFrame;
        try {
          frame = decodeInput(data, this.environment.authorityTime());
        } catch {
          return;
        }
        const cursor = this.cursorInputs.get(from);
        const time = this.environment.authorityTime();
        if (
          player.connected &&
          player.venueId === me.id &&
          cursor?.ready &&
          frame.generation === cursor.generation &&
          frame.time <= time + 100 &&
          time - frame.time <= 2000 &&
          (cursor.seq === null || newer(frame.seq, cursor.seq))
        ) {
          cursor.seq = frame.seq;
          this.localCursors.set(from, {
            point: { x: frame.x, y: frame.y },
            at: this.environment.localTime(),
            color: player.color,
            name: player.name,
          });
        }
        if (me.role === 'host') this.effects.authorityInput(from, data);
        else {
          const packet = new Uint8Array(data.byteLength + 1);
          packet[0] = player.seat;
          packet.set(new Uint8Array(data), 1);
          this.effects.send(me.hostId, 'input', packet.buffer);
        }
      } else if (channel === 'ctrl') {
        const cursor = this.cursorInputs.get(from);
        if (cursor && player.connected && player.venueId === me.id) {
          if (data.type === 'ready' && data.generation === cursor.generation)
            cursor.ready = true;
          else if (data.type === 'hello') {
            cursor.ready = false;
            this.localCursors.delete(from);
          }
        }
        if (me.role === 'host') this.effects.authorityControl(from, data);
        else
          this.effects.send(me.hostId, 'ctrl', {
            type: 'fromController',
            playerId: from,
            message: data,
          });
      }
      return;
    }
    if (me.role === 'host') {
      const venue = this.roster.venues.find(
        (v) => v.id === from && v.connected,
      );
      if (!venue) return;
      if (
        channel === 'input' &&
        data instanceof ArrayBuffer &&
        data.byteLength === 48
      ) {
        const packet = new Uint8Array(data),
          p = this.roster.players.find(
            (p) => p.seat === packet[0] && p.venueId === from,
          );
        if (p) this.effects.authorityInput(p.id, data.slice(1));
      } else if (channel === 'ctrl') {
        if (data.type === 'fromController') {
          const p = this.roster.players.find(
            (p) => p.id === data.playerId && p.venueId === from,
          );
          if (p) this.effects.authorityControl(p.id, data.message);
        } else this.effects.authorityControl(from, data);
      }
      return;
    }
    if (from === me.hostId) {
      if (channel === 'ctrl' && data.type === 'toController') {
        if (
          this.roster.players.some(
            (p) => p.id === data.target && p.venueId === me.id,
          )
        ) {
          this.cursorConfig(data.target, data.message);
          this.effects.send(data.target, 'ctrl', data.message);
        }
      } else this.effects.display(channel, data);
    }
  }
  private cursorConfig(playerId: string, message: Message) {
    if (
      !this.active ||
      this.terminal ||
      !message ||
      message.type !== 'config' ||
      message.config?.schemaVersion !== 1 ||
      !Number.isInteger(message.config.generation) ||
      message.config.generation < 0 ||
      message.config.generation > 65535 ||
      !this.roster.players.some(
        (player) =>
          player.id === playerId &&
          player.connected &&
          player.venueId === this.identity?.id,
      )
    )
      return;
    const generation = message.config.generation as number;
    if (this.cursorInputs.get(playerId)?.generation === generation) return;
    this.cursorInputs.set(playerId, { generation, ready: false, seq: null });
    this.localCursors.delete(playerId);
  }
  private clearLocalCursors() {
    this.cursorInputs.clear();
    this.localCursors.clear();
  }
  cursors() {
    return Object.freeze(
      [...this.localCursors.entries()]
        .filter(([, c]) => this.environment.localTime() - c.at < 1000)
        .map(([id, c]) =>
          Object.freeze({ id, ...c, point: Object.freeze({ ...c.point }) }),
        ),
    );
  }
}
