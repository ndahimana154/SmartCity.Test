export type SensorType =
    | 'camera'
    | 'inductive-loop'
    | 'radar'
    | 'weight'
    | 'pedestrian-button'
    | 'manual-trigger';

export type VehicleClass =
    | 'car'
    | 'motorbike'
    | 'bus'
    | 'truck'
    | 'pedestrian'
    | 'ambulance'
    | 'fire-truck'
    | 'police';

export interface CameraDetection {
    className: VehicleClass;
    confidence: number;
    laneId: string;
    speedMps?: number;
}

export interface CameraSensorPayload {
    detections: CameraDetection[];
}

export interface InductiveLoopSensorPayload {
    laneId: string;
    vehiclePresent: boolean;
    occupancyRatio: number;
}

export interface RadarLaneReading {
    laneId: string;
    count: number;
    averageSpeedMps: number;
    queueLength: number;
}

export interface RadarSensorPayload {
    lanes: RadarLaneReading[];
}

export interface WeightSensorPayload {
    laneId: string;
    weightKg: number;
    vehiclePresent: boolean;
}

export interface PedestrianButtonPayload {
    laneId: string;
    pressed: boolean;
}

export type SensorPayload =
    | CameraSensorPayload
    | InductiveLoopSensorPayload
    | RadarSensorPayload
    | WeightSensorPayload
    | PedestrianButtonPayload;

export interface SensorSnapshot {
    sensorId: string;
    type: SensorType;
    simulationTimeSeconds: number;
    payload: SensorPayload;
}

export interface LaneMetrics {
    laneId: string;
    vehicleCount: number;
    queueLength: number;
    averageSpeedMps: number;
    busWaiting: boolean;
    emergencyWaiting: boolean;
    pedestrianWaiting: boolean;
}

export interface IntersectionMetrics {
    intersectionId: string;
    timeSeconds: number;
    lanes: Record<string, LaneMetrics>;
}

export interface SensorFrame {
    simulationTimeSeconds: number;
    snapshots: SensorSnapshot[];
}

export function emptyLaneMetrics(laneId: string): LaneMetrics {
    return {
        laneId,
        vehicleCount: 0,
        queueLength: 0,
        averageSpeedMps: 0,
        busWaiting: false,
        emergencyWaiting: false,
        pedestrianWaiting: false,
    };
}
