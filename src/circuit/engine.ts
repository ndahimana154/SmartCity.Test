import type { Connection, PortMap, SimulationComponent, SimulationState } from './models';
import type { SmartPLC } from '../plc';

function executeProgrammableCode(code: string, inputs: PortMap): { outputs: PortMap; error?: string } {
    try {
        // Wrap user code so that a named function declaration is visible before the call.
        // 'new Function' with "use strict" prevents hoisted function declarations in some engines.
        const compiled = new Function(
            'inputs',
            `${code}\nif (typeof update !== "function") { throw new Error("Define function update(inputs)"); }\nreturn update(inputs);`,
        ) as (input: PortMap) => PortMap;

        const result = compiled(inputs);
        const normalized: PortMap = {};

        Object.keys(result).forEach((key) => {
            normalized[key] = Boolean(result[key]);
        });

        return { outputs: normalized };
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown user code error';
        return { outputs: {}, error: message };
    }
}

function executeTrafficControllerCode(
    code: string,
    timeSeconds: number,
): { outputs: { red: boolean; yellow: boolean; green: boolean }; error?: string } {
    const fallback = { red: true, yellow: false, green: false };
    try {
        const compiled = new Function(
            'time',
            `${code}\nif (typeof update !== "function") { throw new Error("Define function update(time)"); }\nreturn update(time);`,
        ) as (time: number) => Record<string, boolean>;

        const result = compiled(timeSeconds);
        const red = Boolean(result.red);
        const yellow = Boolean(result.yellow);
        const green = Boolean(result.green);

        // Enforce single-light constraint: priority red > yellow > green
        if (red) return { outputs: { red: true, yellow: false, green: false } };
        if (yellow) return { outputs: { red: false, yellow: true, green: false } };
        if (green) return { outputs: { red: false, yellow: false, green: true } };

        // No light active — default to red as safety fallback
        return { outputs: fallback };
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown controller error';
        return { outputs: fallback, error: message };
    }
}

function updateComponent(component: SimulationComponent, timeSeconds: number): SimulationComponent {
    if (component.type === 'switch') {
        return {
            ...component,
            lastError: undefined,
            outputs: component.update(component.inputs, component),
        };
    }

    if (component.type === 'programmable') {
        const { outputs, error } = executeProgrammableCode(component.code ?? '', component.inputs);
        const prepared = {
            ...component,
            outputs: {
                ...component.outputs,
                ...outputs,
            },
        };

        return {
            ...prepared,
            outputs: prepared.update(prepared.inputs, prepared),
            lastError: error,
        };
    }

    if (component.type === 'trafficController') {
        const { outputs, error } = executeTrafficControllerCode(component.code ?? '', timeSeconds);
        return { ...component, outputs, lastError: error };
    }

    if (component.type === 'smartPlc') {
        const plc = component.plcInstance as SmartPLC | undefined;
        if (!plc) {
            return { ...component, lastError: 'SmartPLC instance not initialized' };
        }

        try {
            // Call SmartPLC update with empty sensor frame
            const result = plc.update({
                frame: {
                    simulationTimeSeconds: timeSeconds,
                    snapshots: [],
                },
                simulationTimeSeconds: timeSeconds,
            });
            const nextOutputs: PortMap = {};

            // Convert PLC light commands to output ports
            // Light states are 'RED', 'YELLOW', 'GREEN'
            Object.entries(result.lightCommands).forEach(([lightId, lightState]) => {
                nextOutputs[`${lightId}_RED`] = lightState === 'RED';
                nextOutputs[`${lightId}_YELLOW`] = lightState === 'YELLOW';
                nextOutputs[`${lightId}_GREEN`] = lightState === 'GREEN';
            });

            return {
                ...component,
                outputs: nextOutputs,
                lastError: undefined,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown PLC error';
            return { ...component, lastError: message };
        }
    }

    // trafficLight and lightBulb: derive outputs from inputs via update()
    return {
        ...component,
        lastError: undefined,
        outputs: component.update(component.inputs, component),
    };
}

function clearInputs(component: SimulationComponent): SimulationComponent {
    const nextInputs: PortMap = {};

    Object.keys(component.inputs).forEach((key) => {
        nextInputs[key] = false;
    });

    return {
        ...component,
        inputs: nextInputs,
    };
}

function propagateConnections(
    components: SimulationComponent[],
    connections: Connection[],
): SimulationComponent[] {
    const componentMap = new Map<string, SimulationComponent>(components.map((item) => [item.id, item]));

    connections.forEach((connection) => {
        const from = componentMap.get(connection.fromComponentId);
        const to = componentMap.get(connection.toComponentId);

        if (!from || !to) {
            return;
        }

        const nextValue = Boolean(from.outputs[connection.outputKey]);

        if (nextValue) {
            to.inputs[connection.inputKey] = true;
        }
    });

    return Array.from(componentMap.values());
}

export function simulationTick(state: SimulationState): SimulationState {
    const nextTimeSeconds = Math.round((state.timeSeconds + 0.1) * 10) / 10;
    // Update trafficController and smartPlc before propagation for immediate outputs
    const controllersUpdated = state.components.map((component) =>
        component.type === 'trafficController' || component.type === 'smartPlc'
            ? updateComponent(component, nextTimeSeconds)
            : component,
    );
    const cleared = controllersUpdated.map(clearInputs);
    const propagated = propagateConnections(cleared, state.connections);
    // Skip updating trafficController and smartPlc again (already updated above)
    const updated = propagated.map((component) =>
        component.type === 'trafficController' || component.type === 'smartPlc'
            ? component
            : updateComponent(component, nextTimeSeconds),
    );

    return {
        ...state,
        components: updated,
        tickCount: state.tickCount + 1,
        timeSeconds: nextTimeSeconds,
    };
}
