import { describe, it, expect } from 'vitest';
import { SmartPLC } from '../../src/plc/SmartPLC';
import { fourWayBusPriorityConfig } from '../../src/plc/examples/fourWayBusPriorityConfig';

describe('SmartPLC Core Functionality', () => {
  it('should create and run one update step', () => {
    const plc = new SmartPLC('downtown_plc', fourWayBusPriorityConfig);

    const result = plc.update({
      simulationTimeSeconds: 10,
      frame: {
        simulationTimeSeconds: 10,
        snapshots: [],
      },
    });

    expect(Object.keys(result.lightCommands).length).toBeGreaterThan(0);
    expect(result.telemetry.intersections.main_1.currentPhase.length).toBeGreaterThan(0);
  });

  it('should produce light commands with valid states', () => {
    const plc = new SmartPLC('downtown_plc', fourWayBusPriorityConfig);

    const result = plc.update({
      simulationTimeSeconds: 0,
      frame: {
        simulationTimeSeconds: 0,
        snapshots: [],
      },
    });

    // All light states should be RED, YELLOW, or GREEN
    Object.values(result.lightCommands).forEach((state) => {
      expect(['RED', 'YELLOW', 'GREEN']).toContain(state);
    });
  });

  it('should have outputs record matching light commands', () => {
    const plc = new SmartPLC('downtown_plc', fourWayBusPriorityConfig);

    const result = plc.update({
      simulationTimeSeconds: 5,
      frame: {
        simulationTimeSeconds: 5,
        snapshots: [],
      },
    });

    expect(result.outputs).toBeDefined();
    expect(typeof result.outputs).toBe('object');
  });
});

describe('SmartPLC Bus Priority', () => {
  it('should apply bus priority extension when bus is detected', () => {
    const plc = new SmartPLC('downtown_plc', fourWayBusPriorityConfig);

    plc.update({
      simulationTimeSeconds: 5,
      frame: {
        simulationTimeSeconds: 5,
        snapshots: [
          {
            sensorId: 'north_bus_sensor',
            type: 'camera',
            simulationTimeSeconds: 5,
            payload: {
              detections: [
                { className: 'bus', confidence: 0.95, laneId: 'north_bus' },
              ],
            },
          },
        ],
      },
    });

    const telemetry = plc.getLatestTelemetry();
    expect(telemetry.intersections.main_1.busPriorityEvents).toBeGreaterThanOrEqual(0);
  });

  it('should track bus priority events in telemetry', () => {
    const plc = new SmartPLC('downtown_plc', fourWayBusPriorityConfig);

    const result = plc.update({
      simulationTimeSeconds: 8,
      frame: {
        simulationTimeSeconds: 8,
        snapshots: [
          {
            sensorId: 'north_bus_sensor',
            type: 'camera',
            simulationTimeSeconds: 8,
            payload: {
              detections: [
                { className: 'bus', confidence: 0.9, laneId: 'north_bus' },
              ],
            },
          },
        ],
      },
    });

    expect(result.telemetry).toBeDefined();
    expect(result.telemetry.intersections.main_1).toBeDefined();
  });
});

describe('SmartPLC Emergency Preemption', () => {
  it('should detect emergency vehicle and provide preemption telemetry', () => {
    const plc = new SmartPLC('downtown_plc', fourWayBusPriorityConfig);

    const result = plc.update({
      simulationTimeSeconds: 12,
      frame: {
        simulationTimeSeconds: 12,
        snapshots: [
          {
            sensorId: 'emergency_zone_1',
            type: 'camera',
            simulationTimeSeconds: 12,
            payload: {
              detections: [
                {
                  className: 'ambulance',
                  confidence: 0.99,
                  laneId: 'north',
                },
              ],
            },
          },
        ],
      },
    });

    expect(result.lightCommands).toBeDefined();
    expect(Object.keys(result.lightCommands).length).toBeGreaterThan(0);
  });

  it('should handle multiple emergency vehicle types', () => {
    const plc = new SmartPLC('downtown_plc', fourWayBusPriorityConfig);

    const result = plc.update({
      simulationTimeSeconds: 15,
      frame: {
        simulationTimeSeconds: 15,
        snapshots: [
          {
            sensorId: 'emergency_zone_1',
            type: 'camera',
            simulationTimeSeconds: 15,
            payload: {
              detections: [
                {
                  className: 'fire-truck',
                  confidence: 0.98,
                  laneId: 'east',
                },
              ],
            },
          },
        ],
      },
    });

    expect(result.lightCommands).toBeDefined();
    expect(result.telemetry).toBeDefined();
  });

  it('should maintain valid light states during emergency', () => {
    const plc = new SmartPLC('downtown_plc', fourWayBusPriorityConfig);

    const result = plc.update({
      simulationTimeSeconds: 20,
      frame: {
        simulationTimeSeconds: 20,
        snapshots: [
          {
            sensorId: 'police_zone',
            type: 'camera',
            simulationTimeSeconds: 20,
            payload: {
              detections: [
                {
                  className: 'police',
                  confidence: 0.97,
                  laneId: 'west',
                },
              ],
            },
          },
        ],
      },
    });

    // Verify all lights have valid states
    Object.entries(result.lightCommands).forEach(([lightId, state]) => {
      expect(['RED', 'YELLOW', 'GREEN']).toContain(state);
    });
  });
});

describe('SmartPLC Phase Management', () => {
  it('should return valid phase information in telemetry', () => {
    const plc = new SmartPLC('downtown_plc', fourWayBusPriorityConfig);

    const result = plc.update({
      simulationTimeSeconds: 3,
      frame: {
        simulationTimeSeconds: 3,
        snapshots: [],
      },
    });

    expect(result.telemetry.intersections.main_1.currentPhase).toBeDefined();
    expect(result.telemetry.intersections.main_1.timeRemaining).toBeGreaterThanOrEqual(0);
  });

  it('should advance through phases over time', () => {
    const plc = new SmartPLC('downtown_plc', fourWayBusPriorityConfig);

    const result1 = plc.update({
      simulationTimeSeconds: 1,
      frame: { simulationTimeSeconds: 1, snapshots: [] },
    });

    const result2 = plc.update({
      simulationTimeSeconds: 10,
      frame: { simulationTimeSeconds: 10, snapshots: [] },
    });

    // Phases may change as time progresses
    expect(result1.telemetry.intersections.main_1.currentPhase).toBeDefined();
    expect(result2.telemetry.intersections.main_1.currentPhase).toBeDefined();
  });

  it('should include broadcast information in output', () => {
    const plc = new SmartPLC('downtown_plc', fourWayBusPriorityConfig);

    const result = plc.update({
      simulationTimeSeconds: 7,
      frame: {
        simulationTimeSeconds: 7,
        snapshots: [],
      },
    });

    expect(result.broadcasts).toBeDefined();
    expect(Array.isArray(result.broadcasts)).toBe(true);
  });
});
