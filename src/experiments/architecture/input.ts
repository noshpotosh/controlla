import { defaultCapabilities } from '../../core/config.ts';
import type { Capabilities } from '../../core/types.ts';
export {
  controllerManifest,
  resolveController,
} from '../../client/engine/input.ts';
export function capabilityProfile(motion: boolean): Capabilities {
  const capabilities = defaultCapabilities();
  if (motion) {
    capabilities.sensors.gyro = { present: true, permission: 'granted' };
    capabilities.sensors.accel = { present: true, permission: 'granted' };
  }
  return capabilities;
}
