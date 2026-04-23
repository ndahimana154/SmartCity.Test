import { SimulationEngine } from './engine'
import { LightBulbNode, SwitchNode } from './nodes'
import type { SignalEvent, Wire } from './types'

export interface CircuitSystem {
    switchNode: SwitchNode
    bulbNode: LightBulbNode
    engine: SimulationEngine
}

export function createCircuitSystem(onSignal?: (event: SignalEvent) => void): CircuitSystem {
    const switchNode = new SwitchNode('switch-1', false)
    const bulbNode = new LightBulbNode('bulb-1')

    const wires: Wire[] = [
        {
            id: 'wire-switch-to-bulb',
            from: { componentId: switchNode.id, port: 'out' },
            to: { componentId: bulbNode.id, port: 'in' },
        },
    ]

    const engine = new SimulationEngine([switchNode, bulbNode], wires, onSignal)

    engine.tick()

    return {
        switchNode,
        bulbNode,
        engine,
    }
}
