import { defaultCapabilities } from '../../controls/resolve.ts';
import type { Capabilities } from '../../controls/api.ts';
export function capabilityProfile(motion: boolean): Capabilities {
  const capabilities = defaultCapabilities();
  if (motion) {
    capabilities.sensors.gyro = { present: true, permission: 'granted' };
    capabilities.sensors.accel = { present: true, permission: 'granted' };
  }
  return capabilities;
}
