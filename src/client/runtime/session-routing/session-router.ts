import { decodeInput, type InputFrame } from '../../engine/protocol.ts';
import type { Channel, Message } from '../../engine/messages.ts';
import type { Identity, Roster } from '../../../shared/room.ts';
import type { CursorObservations } from '../cursor-contracts.ts';

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
  cursors: CursorObservations;
  isOpen(id: string): boolean;
  ensureHostFallback(): void;
}
/** Session routing policy; transport and application lifecycle remain external. */
export class SessionRouter {
  private identity: RoutingIdentity | null = null;
  private roster: Roster = { players: [], venues: [] };
  private controllerPath: ControllerRoute = 'venue';
  private active = false;
  private terminal = false;
  private epoch = 0;
  private readonly joinedAt: number;
  constructor(
    private readonly environment: RoutingEnvironment,
    private readonly effects: RoutingEffects,
  ) {
    this.joinedAt = environment.localTime();
  }
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
    this.effects.cursors.roster(this.identity?.id ?? null, roster);
  }
  updateControllerRoute(): ControllerRoute {
    const me = this.identity;
    if (
      this.active &&
      !this.terminal &&
      me?.role === 'controller' &&
      me.venueId !== me.hostId &&
      this.environment.localTime() - this.joinedAt > 8000
    ) {
      this.controllerPath = this.effects.isOpen(me.venueId)
        ? 'venue'
        : 'direct-to-session';
      if (this.controllerPath === 'direct-to-session')
        this.effects.ensureHostFallback();
    }
    return this.controllerPath;
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
    this.effects.cursors.clear();
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
      this.effects.cursors.configure(id, message);
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
        this.effects.cursors.input(
          player,
          frame,
          this.environment.authorityTime(),
          this.environment.localTime(),
        );
        if (me.role === 'host') this.effects.authorityInput(from, data);
        else {
          const packet = new Uint8Array(data.byteLength + 1);
          packet[0] = player.seat;
          packet.set(new Uint8Array(data), 1);
          this.effects.send(me.hostId, 'input', packet.buffer);
        }
      } else if (channel === 'ctrl') {
        this.effects.cursors.control(player, data);
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
          this.effects.cursors.configure(data.target, data.message);
          this.effects.send(data.target, 'ctrl', data.message);
        }
      } else this.effects.display(channel, data);
    }
  }
}
