export type Signal = boolean

export interface PortSignals {
    [portName: string]: Signal
}

export interface SimComponent {
    id: string
    inputs: PortSignals
    outputs: PortSignals
    update: () => boolean
}

export interface WireEnd {
    componentId: string
    port: string
}

export interface Wire {
    id: string
    from: WireEnd
    to: WireEnd
}

export interface SignalEvent {
    wireId: string
    fromComponentId: string
    toComponentId: string
    value: Signal
}

export interface EngineSnapshot {
    switchOn: boolean
    bulbOn: boolean
}

export interface EngineResult {
    stabilized: boolean
    iterations: number
    snapshot: EngineSnapshot
}
