import { LightBulbNode, SwitchNode } from './nodes'
import type {
    EngineResult,
    SignalEvent,
    SimComponent,
    Wire,
    WireEnd,
} from './types'

type LogHandler = (event: SignalEvent) => void

export class SimulationEngine {
    private readonly components = new Map<string, SimComponent>()
    private readonly wires: Wire[]
    private readonly onSignal?: LogHandler

    constructor(components: SimComponent[], wires: Wire[], onSignal?: LogHandler) {
        components.forEach((component) => this.components.set(component.id, component))
        this.wires = wires
        this.onSignal = onSignal
    }

    public tick(maxIterations = 8): EngineResult {
        let iterationsRun = 0
        let changed = false

        for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
            iterationsRun = iteration
            changed = false

            for (const component of this.components.values()) {
                if (component.update()) {
                    changed = true
                }
            }

            for (const wire of this.wires) {
                if (this.propagateWire(wire)) {
                    changed = true
                }
            }

            if (!changed) {
                break
            }
        }

        return {
            stabilized: !changed,
            iterations: iterationsRun,
            snapshot: this.getSnapshot(),
        }
    }

    public getSnapshot() {
        const switchNode = this.requireNode<SwitchNode>('switch-1')
        const bulbNode = this.requireNode<LightBulbNode>('bulb-1')

        return {
            switchOn: switchNode.isOn,
            bulbOn: bulbNode.isLit,
        }
    }

    private requireNode<T extends SimComponent>(id: string): T {
        const component = this.components.get(id)
        if (!component) {
            throw new Error(`Component ${id} was not found in engine`)
        }

        return component as T
    }

    private propagateWire(wire: Wire): boolean {
        const source = this.resolveWireEnd(wire.from)
        const target = this.resolveWireEnd(wire.to)

        const nextValue = source.outputs[wire.from.port] ?? false
        const previousValue = target.inputs[wire.to.port] ?? false

        if (previousValue === nextValue) {
            return false
        }

        target.inputs[wire.to.port] = nextValue
        this.onSignal?.({
            wireId: wire.id,
            fromComponentId: wire.from.componentId,
            toComponentId: wire.to.componentId,
            value: nextValue,
        })

        return true
    }

    private resolveWireEnd(end: WireEnd): SimComponent {
        const component = this.components.get(end.componentId)
        if (!component) {
            throw new Error(`Wire end references unknown component ${end.componentId}`)
        }

        return component
    }
}
