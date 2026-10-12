import type {TriggerMessage} from "./validation";

export type VehicleState = "parked" | "moving" | "unknown";

// Customer extension point: derive an action from vehicle data, never from a UI click.
export function vehicleState(message: TriggerMessage): VehicleState {
  const standard = message.data.standard as Record<string, unknown>;
  const speed = standard.perfVehicleSpeed;
  // Conflicting movement data takes precedence over a parking signal.
  if (typeof speed === "number" && speed > 0) return "moving";
  if (standard.gearSelection === "GEAR_PARK" || standard.parkingBrakeOn === true) return "parked";
  if (["GEAR_DRIVE", "GEAR_REVERSE"].includes(String(standard.gearSelection))) return "moving";
  return "unknown";
}

export function actOnTrigger(message: TriggerMessage): string {
  const state = vehicleState(message);
  return state === "parked" ? "Vehicle parked" : state === "moving" ? "Vehicle moving" : "Vehicle data updated";
}
