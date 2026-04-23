import type { PortSignals, SimComponent } from './types'

export class SwitchNode implements SimComponent {
    public readonly id: string
    public readonly inputs: PortSignals = {}
    public readonly outputs: PortSignals = { out: false }
    private _isOn = false

    constructor(id: string, initialState = false) {
        this.id = id
        this._isOn = initialState
        this.outputs.out = initialState
    }

    public get isOn(): boolean {
        return this._isOn
    }

    public toggle(): void {
        this._isOn = !this._isOn
    }

    public update(): boolean {
        const next = this._isOn
        if (this.outputs.out === next) {
            return false
        }

        this.outputs.out = next
        return true
    }
}

export class LightBulbNode implements SimComponent {
    public readonly id: string
    public readonly inputs: PortSignals = { in: false }
    public readonly outputs: PortSignals = { lit: false }

    constructor(id: string) {
        this.id = id
    }

    public get isLit(): boolean {
        return this.outputs.lit
    }

    public update(): boolean {
        const inputSignal = this.inputs.in ?? false
        if (this.outputs.lit === inputSignal) {
            return false
        }

        this.outputs.lit = inputSignal
        return true
    }
}
