import {
    type IntersectionMetrics,
    type LaneMetrics,
    type SensorFrame,
    emptyLaneMetrics,
} from './SensorTypes';
import {
    assertValidSmartPLCConfig,
    type IntersectionConfig,
    type LightState,
    type PhaseConfig,
    type SmartPLCConfig,
} from './TrafficConfig';
import { BusPriorityModule } from './BusPriorityModule';
import { DynamicTimingEngine } from './DynamicTimingEngine';

interface ConnectedLight {
    id: string;
    setState?: (state: LightState) => void;
}

interface ConnectedSensor {
    id: string;
    read?: () => unknown;
}

interface IntersectionRuntime {
    currentPhaseIndex: number;
    phaseStartedAt: number;
    phaseDuration: number;
    emergencyActive: boolean;
    emergencyLaneId: string | null;
    manualPhaseName: string | null;
    busEvents: number;
    vehiclesPassed: number;
}

export interface PLCTelemetry {
    plcId: string;
    timeSeconds: number;
    intersections: Record<
        string,
        {
            currentPhase: string;
            timeRemaining: number;
            laneVehicleCounts: Record<string, number>;
            laneQueueLengths: Record<string, number>;
            busPriorityEvents: number;
            averageWaitSeconds: number;
            throughputVpm: number;
            emergencyActive: boolean;
        }
    >;
    logs: PLCLogEvent[];
}

export interface PLCLogEvent {
    timeSeconds: number;
    type:
    | 'phase-change'
    | 'bus-priority'
    | 'emergency-preemption'
    | 'script-error'
    | 'manual-override';
    message: string;
    intersectionId: string;
}

export interface SmartPLCUpdateInput {
    frame: SensorFrame;
    simulationTimeSeconds: number;
}

export interface SmartPLCUpdateOutput {
    outputs: Record<string, boolean>;
    lightCommands: Record<string, LightState>;
    telemetry: PLCTelemetry;
    broadcasts: Record<string, unknown>[];
}

interface ScriptApi {
    getSensorValue: (sensorId: string) => unknown;
    getCurrentPhase: (intersectionId?: string) => string;
    extendGreenBy: (seconds: number, intersectionId?: string) => void;
    switchToPhase: (phaseName: string, intersectionId?: string) => void;
    log: (message: string) => void;
    getSimulationTime: () => number;
}

interface UserHooks {
    calculateGreenTime?: (
        laneId: string,
        queueLength: number,
        timeOfDayHour: number,
        busWaiting: boolean,
    ) => number;
    onBusDetected?: (laneId: string, busCount: number) => void;
    onEmergencyDetected?: (laneId: string) => void;
    onUpdate?: () => void;
}

/**
 * SmartPLC is a deterministic, simulation-clock based traffic controller.
 * Logic is completely independent from rendering and can drive both 2D/3D views.
 */
export class SmartPLC {
    readonly id: string;

    private config: SmartPLCConfig;
    private runtimeByIntersection = new Map<string, IntersectionRuntime>();
    private lights = new Map<string, ConnectedLight>();
    private sensors = new Map<string, ConnectedSensor>();
    private latestSensorValues = new Map<string, unknown>();
    private latestMetricsByIntersection = new Map<string, IntersectionMetrics>();
    private logs: PLCLogEvent[] = [];
    private peerPackets = new Map<string, Record<string, unknown>>();

    private busPriorityModule: BusPriorityModule;
    private timingEngine: DynamicTimingEngine;

    private manualMode = false;
    private simulationTimeSeconds = 0;
    private hooks: UserHooks = {};

    constructor(id: string, config: SmartPLCConfig) {
        this.id = id;
        this.config = assertValidSmartPLCConfig(config);
        this.busPriorityModule = new BusPriorityModule(this.config.busPriority);
        this.timingEngine = new DynamicTimingEngine(this.config.timingParameters);
        this.initializeRuntime(0);
    }

    connectSensor(sensorId: string, sensor: ConnectedSensor): void {
        this.sensors.set(sensorId, sensor);
    }

    connectLight(lightId: string, light: ConnectedLight): void {
        this.lights.set(lightId, light);
    }

    setManualMode(enabled: boolean): void {
        this.manualMode = enabled;
    }

    setManualOverride(intersectionId: string, phaseName: string | null): void {
        const runtime = this.runtimeByIntersection.get(intersectionId);
        if (!runtime) {
            return;
        }

        runtime.manualPhaseName = phaseName;
        this.log(intersectionId, 'manual-override', `manual phase set to ${phaseName ?? 'none'}`);
    }

    setScript(scriptCode: string): void {
        this.hooks = this.compileScript(scriptCode);
    }

    updateConfig(nextConfig: SmartPLCConfig, preserveState = true): void {
        const validated = assertValidSmartPLCConfig(nextConfig);
        this.config = validated;
        this.timingEngine.updateConfig(validated.timingParameters);
        this.busPriorityModule.updateConfig(validated.busPriority);
        this.initializeRuntime(this.simulationTimeSeconds, preserveState);
    }

    applyPeerStatus(peerId: string, packet: Record<string, unknown>): void {
        this.peerPackets.set(peerId, packet);
    }

    getLatestTelemetry(): PLCTelemetry {
        return this.buildTelemetry(this.simulationTimeSeconds);
    }

    update(input: SmartPLCUpdateInput): SmartPLCUpdateOutput {
        this.simulationTimeSeconds = input.simulationTimeSeconds;

        this.ingestSensors(input.frame);

        const allLightCommands: Record<string, LightState> = {};
        this.config.intersections.forEach((intersection) => {
            const metrics = this.computeIntersectionMetrics(intersection, input.simulationTimeSeconds);
            this.latestMetricsByIntersection.set(intersection.id, metrics);

            const commands = this.advanceIntersection(intersection, metrics, input.simulationTimeSeconds);
            Object.assign(allLightCommands, commands);
        });

        Object.entries(allLightCommands).forEach(([lightId, state]) => {
            this.lights.get(lightId)?.setState?.(state);
        });

        const outputs = this.commandsToOutputs(allLightCommands);
        const telemetry = this.buildTelemetry(input.simulationTimeSeconds);

        return {
            outputs,
            lightCommands: allLightCommands,
            telemetry,
            broadcasts: [
                {
                    plcId: this.id,
                    timeSeconds: input.simulationTimeSeconds,
                    intersections: telemetry.intersections,
                },
            ],
        };
    }

    private initializeRuntime(timeSeconds: number, preserveState = false): void {
        const previous = new Map(this.runtimeByIntersection);
        this.runtimeByIntersection = new Map();

        this.config.intersections.forEach((intersection) => {
            const phaseDuration = this.resolvePhaseDuration(
                intersection,
                intersection.phases[0],
                emptyMetrics(intersection),
                timeSeconds,
            );

            const prior = preserveState ? previous.get(intersection.id) : undefined;
            this.runtimeByIntersection.set(intersection.id, {
                currentPhaseIndex: prior?.currentPhaseIndex ?? 0,
                phaseStartedAt: prior?.phaseStartedAt ?? timeSeconds,
                phaseDuration: prior?.phaseDuration ?? phaseDuration,
                emergencyActive: false,
                emergencyLaneId: null,
                manualPhaseName: prior?.manualPhaseName ?? null,
                busEvents: prior?.busEvents ?? 0,
                vehiclesPassed: prior?.vehiclesPassed ?? 0,
            });
        });
    }

    private ingestSensors(frame: SensorFrame): void {
        this.sensors.forEach((sensor, sensorId) => {
            const reading = sensor.read?.();
            if (reading !== undefined) {
                this.latestSensorValues.set(sensorId, reading);
            }
        });

        frame.snapshots.forEach((snapshot) => {
            this.latestSensorValues.set(snapshot.sensorId, snapshot);
        });
    }

    private computeIntersectionMetrics(
        intersection: IntersectionConfig,
        simulationTimeSeconds: number,
    ): IntersectionMetrics {
        const lanes: Record<string, LaneMetrics> = {};
        intersection.lanes.forEach((laneId) => {
            lanes[laneId] = emptyLaneMetrics(laneId);
        });

        this.latestSensorValues.forEach((value) => {
            const snapshot = value as { type?: string; payload?: unknown };
            if (!snapshot.type || !snapshot.payload) {
                return;
            }

            if (snapshot.type === 'radar') {
                const payload = snapshot.payload as { lanes?: Array<{ laneId: string; count: number; queueLength: number; averageSpeedMps: number }> };
                payload.lanes?.forEach((lane) => {
                    if (!lanes[lane.laneId]) {
                        return;
                    }
                    lanes[lane.laneId].vehicleCount += lane.count;
                    lanes[lane.laneId].queueLength = Math.max(lanes[lane.laneId].queueLength, lane.queueLength);
                    lanes[lane.laneId].averageSpeedMps = lane.averageSpeedMps;
                });
            }

            if (snapshot.type === 'inductive-loop') {
                const payload = snapshot.payload as { laneId?: string; vehiclePresent?: boolean; occupancyRatio?: number };
                if (!payload.laneId || !lanes[payload.laneId]) {
                    return;
                }
                if (payload.vehiclePresent) {
                    lanes[payload.laneId].vehicleCount += 1;
                    lanes[payload.laneId].queueLength += Math.ceil((payload.occupancyRatio ?? 0) * 3);
                }
            }

            if (snapshot.type === 'weight') {
                const payload = snapshot.payload as { laneId?: string; weightKg?: number; vehiclePresent?: boolean };
                if (!payload.laneId || !lanes[payload.laneId]) {
                    return;
                }

                if (payload.vehiclePresent && (payload.weightKg ?? 0) >= 10000) {
                    lanes[payload.laneId].busWaiting = true;
                }
            }

            if (snapshot.type === 'camera') {
                const payload = snapshot.payload as { detections?: Array<{ laneId: string; className: string }> };
                payload.detections?.forEach((detection) => {
                    if (!lanes[detection.laneId]) {
                        return;
                    }
                    lanes[detection.laneId].vehicleCount += 1;

                    if (detection.className === 'bus') {
                        lanes[detection.laneId].busWaiting = true;
                    }

                    if (
                        detection.className === 'ambulance' ||
                        detection.className === 'fire-truck' ||
                        detection.className === 'police'
                    ) {
                        lanes[detection.laneId].emergencyWaiting = true;
                    }

                    if (detection.className === 'pedestrian') {
                        lanes[detection.laneId].pedestrianWaiting = true;
                    }
                });
            }

            if (snapshot.type === 'pedestrian-button') {
                const payload = snapshot.payload as { laneId?: string; pressed?: boolean };
                if (payload.pressed && payload.laneId && lanes[payload.laneId]) {
                    lanes[payload.laneId].pedestrianWaiting = true;
                }
            }
        });

        return {
            intersectionId: intersection.id,
            timeSeconds: simulationTimeSeconds,
            lanes,
        };
    }

    private advanceIntersection(
        intersection: IntersectionConfig,
        metrics: IntersectionMetrics,
        timeSeconds: number,
    ): Record<string, LightState> {
        const runtime = this.runtimeByIntersection.get(intersection.id);
        if (!runtime) {
            return {};
        }

        this.hooks.onUpdate?.();

        if (this.config.emergencyPreemption.enabled) {
            const emergencyLane = intersection.lanes.find((laneId) => metrics.lanes[laneId].emergencyWaiting) ?? null;
            if (emergencyLane) {
                runtime.emergencyActive = true;
                runtime.emergencyLaneId = emergencyLane;
                this.hooks.onEmergencyDetected?.(emergencyLane);
                this.log(intersection.id, 'emergency-preemption', `emergency lane ${emergencyLane}`);
            }
        }

        if (runtime.emergencyActive && runtime.emergencyLaneId) {
            const stillEmergency = intersection.lanes.some(
                (laneId) => metrics.lanes[laneId].emergencyWaiting,
            );

            if (!stillEmergency) {
                runtime.emergencyActive = false;
                runtime.emergencyLaneId = null;
                runtime.phaseStartedAt = timeSeconds + this.config.emergencyPreemption.clearTime;
            } else {
                return this.commandEmergencyPhase(intersection, runtime.emergencyLaneId);
            }
        }

        if (runtime.emergencyActive && runtime.emergencyLaneId) {
            return this.commandEmergencyPhase(intersection, runtime.emergencyLaneId);
        }

        const nowElapsed = timeSeconds - runtime.phaseStartedAt;
        let effectivePhase = intersection.phases[runtime.currentPhaseIndex];

        if (this.manualMode && runtime.manualPhaseName) {
            const manualPhase = intersection.phases.find((phase) => phase.name === runtime.manualPhaseName);
            if (manualPhase) {
                effectivePhase = manualPhase;
            }
        }

        const laneStates = effectivePhase.lights;

        const busDecision = this.busPriorityModule.decide({
            timeSeconds,
            currentLaneStates: laneStates,
            laneMetrics: metrics.lanes,
            currentPhaseElapsed: nowElapsed,
            intersection,
        });

        if (busDecision.targetLaneId) {
            this.hooks.onBusDetected?.(
                busDecision.targetLaneId,
                this.busPriorityModule.getBusCount(busDecision.targetLaneId),
            );
            runtime.busEvents += 1;
            this.log(intersection.id, 'bus-priority', busDecision.reason);

            if (busDecision.immediateSwitch) {
                const switched = this.switchPhaseToLane(intersection, runtime, busDecision.targetLaneId, timeSeconds);
                if (switched) {
                    effectivePhase = intersection.phases[runtime.currentPhaseIndex];
                }
            } else {
                runtime.phaseDuration = Math.min(
                    runtime.phaseDuration + busDecision.extensionSeconds,
                    this.config.timingParameters.maxGreenTime,
                );
            }
        }

        runtime.phaseDuration += this.getCoordinationBias(intersection);
        runtime.phaseDuration = Math.max(
            this.config.timingParameters.minGreenTime,
            Math.min(this.config.timingParameters.maxGreenTime, runtime.phaseDuration),
        );

        if (nowElapsed >= runtime.phaseDuration) {
            this.stepToNextPhase(intersection, runtime, metrics, timeSeconds);
            effectivePhase = intersection.phases[runtime.currentPhaseIndex];
        }

        this.updateThroughputCounter(intersection, runtime, metrics, effectivePhase);

        return this.phaseToLightCommands(intersection, effectivePhase);
    }

    private switchPhaseToLane(
        intersection: IntersectionConfig,
        runtime: IntersectionRuntime,
        laneId: string,
        timeSeconds: number,
    ): boolean {
        const index = intersection.phases.findIndex(
            (phase) => phase.lights[laneId] === 'GREEN',
        );

        if (index < 0) {
            return false;
        }

        runtime.currentPhaseIndex = index;
        runtime.phaseStartedAt = timeSeconds;
        runtime.phaseDuration = this.resolvePhaseDuration(
            intersection,
            intersection.phases[index],
            emptyMetrics(intersection),
            timeSeconds,
        );

        this.log(
            intersection.id,
            'phase-change',
            `switch phase to ${intersection.phases[index].name} for lane ${laneId}`,
        );
        return true;
    }

    private stepToNextPhase(
        intersection: IntersectionConfig,
        runtime: IntersectionRuntime,
        metrics: IntersectionMetrics,
        timeSeconds: number,
    ): void {
        runtime.currentPhaseIndex = (runtime.currentPhaseIndex + 1) % intersection.phases.length;
        runtime.phaseStartedAt = timeSeconds;
        runtime.phaseDuration = this.resolvePhaseDuration(
            intersection,
            intersection.phases[runtime.currentPhaseIndex],
            metrics,
            timeSeconds,
        );

        this.log(
            intersection.id,
            'phase-change',
            `phase => ${intersection.phases[runtime.currentPhaseIndex].name}`,
        );
    }

    private resolvePhaseDuration(
        intersection: IntersectionConfig,
        phase: PhaseConfig,
        metrics: IntersectionMetrics,
        simulationTimeSeconds: number,
    ): number {
        if (phase.duration !== 'dynamic') {
            return phase.duration;
        }

        const laneDurations = this.timingEngine.computeLaneGreenTimes(
            metrics.lanes,
            simulationTimeSeconds,
            {
                calculateGreenTime: this.hooks.calculateGreenTime,
            },
        );

        const greenLanes = intersection.lanes.filter((laneId) => phase.lights[laneId] === 'GREEN');
        if (!greenLanes.length) {
            return this.config.timingParameters.baseGreenTime;
        }

        const average =
            greenLanes.reduce((sum, laneId) => sum + (laneDurations[laneId] ?? 0), 0) /
            greenLanes.length;

        return Math.max(
            this.config.timingParameters.minGreenTime,
            Math.min(this.config.timingParameters.maxGreenTime, average),
        );
    }

    private phaseToLightCommands(
        intersection: IntersectionConfig,
        phase: PhaseConfig,
    ): Record<string, LightState> {
        const commands: Record<string, LightState> = {};

        intersection.lanes.forEach((laneId) => {
            const lightId = intersection.laneToLight[laneId];
            commands[lightId] = phase.lights[laneId] ?? 'RED';
        });

        return commands;
    }

    private commandEmergencyPhase(
        intersection: IntersectionConfig,
        emergencyLaneId: string,
    ): Record<string, LightState> {
        const commands: Record<string, LightState> = {};

        intersection.lanes.forEach((laneId) => {
            const lightId = intersection.laneToLight[laneId];
            commands[lightId] = laneId === emergencyLaneId ? 'GREEN' : 'RED';
        });

        return commands;
    }

    private updateThroughputCounter(
        intersection: IntersectionConfig,
        runtime: IntersectionRuntime,
        metrics: IntersectionMetrics,
        phase: PhaseConfig,
    ): void {
        intersection.lanes.forEach((laneId) => {
            if (phase.lights[laneId] !== 'GREEN') {
                return;
            }
            runtime.vehiclesPassed += Math.min(2, metrics.lanes[laneId]?.vehicleCount ?? 0);
            if (metrics.lanes[laneId]?.busWaiting) {
                this.busPriorityModule.registerBusPass(laneId);
            }
        });
    }

    private commandsToOutputs(commands: Record<string, LightState>): Record<string, boolean> {
        const outputs: Record<string, boolean> = {};

        Object.entries(commands).forEach(([lightId, state]) => {
            outputs[`${lightId}.red`] = state === 'RED';
            outputs[`${lightId}.yellow`] = state === 'YELLOW';
            outputs[`${lightId}.green`] = state === 'GREEN';
        });

        return outputs;
    }

    private buildTelemetry(timeSeconds: number): PLCTelemetry {
        const intersections: PLCTelemetry['intersections'] = {};

        this.config.intersections.forEach((intersection) => {
            const runtime = this.runtimeByIntersection.get(intersection.id);
            const metrics = this.latestMetricsByIntersection.get(intersection.id) ?? emptyMetrics(intersection);
            const phase = runtime
                ? intersection.phases[runtime.currentPhaseIndex]?.name
                : intersection.phases[0]?.name;

            const laneVehicleCounts: Record<string, number> = {};
            const laneQueueLengths: Record<string, number> = {};
            intersection.lanes.forEach((laneId) => {
                laneVehicleCounts[laneId] = metrics.lanes[laneId]?.vehicleCount ?? 0;
                laneQueueLengths[laneId] = metrics.lanes[laneId]?.queueLength ?? 0;
            });

            const totalQueue = Object.values(laneQueueLengths).reduce((sum, value) => sum + value, 0);
            const laneCount = Math.max(1, Object.keys(laneQueueLengths).length);
            const averageWaitSeconds = Number((totalQueue * 1.8) / laneCount);
            const throughputVpm = Number(((runtime?.vehiclesPassed ?? 0) / Math.max(1, timeSeconds / 60)).toFixed(2));

            intersections[intersection.id] = {
                currentPhase: phase ?? 'UNKNOWN',
                timeRemaining: runtime ? Math.max(0, runtime.phaseDuration - (timeSeconds - runtime.phaseStartedAt)) : 0,
                laneVehicleCounts,
                laneQueueLengths,
                busPriorityEvents: runtime?.busEvents ?? 0,
                averageWaitSeconds,
                throughputVpm,
                emergencyActive: runtime?.emergencyActive ?? false,
            };
        });

        return {
            plcId: this.id,
            timeSeconds,
            intersections,
            logs: [...this.logs],
        };
    }

    private getCoordinationBias(intersection: IntersectionConfig): number {
        if (!this.config.coordination?.enabled) {
            return 0;
        }

        const adjacent = intersection.adjacentIntersections ?? [];
        if (!adjacent.length) {
            return 0;
        }

        let bias = 0;

        this.peerPackets.forEach((packet) => {
            const intersections = (packet.intersections ?? {}) as Record<
                string,
                { currentPhase?: string; timeRemaining?: number }
            >;

            adjacent.forEach((id) => {
                const remote = intersections[id];
                if (!remote || typeof remote.timeRemaining !== 'number') {
                    return;
                }

                if (remote.timeRemaining < 2) {
                    bias += 1;
                } else if (remote.timeRemaining > 8) {
                    bias -= 1;
                }
            });
        });

        return Math.max(
            -this.config.coordination.maxOffsetSeconds,
            Math.min(this.config.coordination.maxOffsetSeconds, bias),
        );
    }

    private compileScript(scriptCode: string): UserHooks {
        const api: ScriptApi = {
            getSensorValue: (sensorId) => this.latestSensorValues.get(sensorId),
            getCurrentPhase: (intersectionId) => {
                const target = intersectionId ?? this.config.intersections[0]?.id;
                if (!target) {
                    return 'UNKNOWN';
                }

                const intersection = this.config.intersections.find((item) => item.id === target);
                const runtime = this.runtimeByIntersection.get(target);
                if (!intersection || !runtime) {
                    return 'UNKNOWN';
                }

                return intersection.phases[runtime.currentPhaseIndex]?.name ?? 'UNKNOWN';
            },
            extendGreenBy: (seconds, intersectionId) => {
                const target = intersectionId ?? this.config.intersections[0]?.id;
                if (!target) {
                    return;
                }

                const runtime = this.runtimeByIntersection.get(target);
                if (!runtime) {
                    return;
                }

                runtime.phaseDuration = Math.min(
                    runtime.phaseDuration + Math.max(0, seconds),
                    this.config.timingParameters.maxGreenTime,
                );
            },
            switchToPhase: (phaseName, intersectionId) => {
                const target = intersectionId ?? this.config.intersections[0]?.id;
                if (!target) {
                    return;
                }

                const intersection = this.config.intersections.find((item) => item.id === target);
                const runtime = this.runtimeByIntersection.get(target);
                if (!intersection || !runtime) {
                    return;
                }

                const phaseIndex = intersection.phases.findIndex((phase) => phase.name === phaseName);
                if (phaseIndex < 0) {
                    return;
                }

                runtime.currentPhaseIndex = phaseIndex;
                runtime.phaseStartedAt = this.simulationTimeSeconds;
                runtime.phaseDuration = this.resolvePhaseDuration(
                    intersection,
                    intersection.phases[phaseIndex],
                    this.latestMetricsByIntersection.get(target) ?? emptyMetrics(intersection),
                    this.simulationTimeSeconds,
                );
            },
            log: (message) => {
                const intersectionId = this.config.intersections[0]?.id ?? 'unknown';
                this.log(intersectionId, 'manual-override', message);
            },
            getSimulationTime: () => this.simulationTimeSeconds,
        };

        try {
            const compiled = new Function(
                'api',
                `
          const { getSensorValue, getCurrentPhase, extendGreenBy, switchToPhase, log, getSimulationTime } = api;
          ${scriptCode}
          return {
            calculateGreenTime: typeof calculateGreenTime === 'function' ? calculateGreenTime : undefined,
            onBusDetected: typeof onBusDetected === 'function' ? onBusDetected : undefined,
            onEmergencyDetected: typeof onEmergencyDetected === 'function' ? onEmergencyDetected : undefined,
            onUpdate: typeof onUpdate === 'function' ? onUpdate : undefined
          };
        `,
            ) as (sandboxApi: ScriptApi) => UserHooks;

            const hooks = compiled(Object.freeze(api));
            return {
                calculateGreenTime: hooks.calculateGreenTime,
                onBusDetected: hooks.onBusDetected,
                onEmergencyDetected: hooks.onEmergencyDetected,
                onUpdate: hooks.onUpdate,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'unknown script compile error';
            const intersectionId = this.config.intersections[0]?.id ?? 'unknown';
            this.log(intersectionId, 'script-error', message);
            return {};
        }
    }

    private log(
        intersectionId: string,
        type: PLCLogEvent['type'],
        message: string,
    ): void {
        this.logs.push({
            timeSeconds: this.simulationTimeSeconds,
            type,
            message,
            intersectionId,
        });

        if (this.logs.length > 1000) {
            this.logs.splice(0, this.logs.length - 1000);
        }
    }
}

function emptyMetrics(intersection: IntersectionConfig): IntersectionMetrics {
    const lanes: Record<string, LaneMetrics> = {};
    intersection.lanes.forEach((laneId) => {
        lanes[laneId] = emptyLaneMetrics(laneId);
    });

    return {
        intersectionId: intersection.id,
        timeSeconds: 0,
        lanes,
    };
}
