const analogFields = ['stickX', 'stickY', 'cStickX', 'cStickY', 'triggerLeft', 'triggerRight', 'analogA', 'analogB'];

export function controllerPacket(port, state, generation) {
  if (!Number.isInteger(port) || port < 0 || port > 3) throw new Error('Controller port must be 0 through 3.');
  if (typeof state?.connected !== 'boolean') throw new Error('Controller connection state is required.');
  if (!Number.isInteger(generation) || generation < 1 || generation > 0xffffffff) throw new Error('Invalid controller generation.');
  if (!Number.isInteger(state.mask) || state.mask < 0 || state.mask > 0xffffffff) throw new Error('Invalid controller button mask.');
  const result = { port, connected: state.connected, mask: state.connected ? state.mask : 0, generation };
  for (const field of analogFields) {
    if (!Number.isInteger(state[field]) || state[field] < 0 || state[field] > 255) throw new Error(`Invalid controller ${field}.`);
    result[field] = state.connected ? state[field] : (field.includes('stick') || field.includes('Stick') ? 128 : 0);
  }
  return result;
}

/** Separate sequence spaces prevent one player's packets suppressing another's. */
export class ControllerInputGate {
  generations = [0, 0, 0, 0];
  reset() { this.generations.fill(0); }
  apply(packet, nativeSetter) {
    const validated = controllerPacket(packet.port, packet, packet.generation);
    const previous = this.generations[validated.port];
    const delta = (validated.generation - previous) >>> 0;
    if (previous && (!delta || delta >= 0x80000000)) return false;
    if (nativeSetter(validated) !== 1) throw new Error('Native core rejected controller input.');
    this.generations[validated.port] = validated.generation;
    return true;
  }
}

export function nativeControllerArguments(packet) {
  return [packet.port, Number(packet.connected), packet.mask, packet.stickX, packet.stickY,
    packet.cStickX, packet.cStickY, packet.triggerLeft, packet.triggerRight,
    packet.analogA, packet.analogB, packet.generation];
}
