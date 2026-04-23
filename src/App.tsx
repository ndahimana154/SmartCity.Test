import { useEffect, useMemo, useReducer, useState } from 'react';
import type { ComponentType } from './circuit/models';
import {
  createInitialState,
  getInputKeys,
  getOutputKeys,
  simulationReducer,
} from './circuit/store';
import SimulationScene3D from './three/SimulationScene3D';
import './App.css';

const LOOP_MS = 100;

const paletteItems: { type: ComponentType; label: string }[] = [
  { type: 'switch', label: 'Switch' },
  { type: 'lightBulb', label: 'LightBulb' },
  { type: 'programmable', label: 'Programmable' },
  { type: 'trafficController', label: 'Traffic Controller' },
  { type: 'trafficLight', label: 'Traffic Light' },
];

function App() {
  const [state, dispatch] = useReducer(
    simulationReducer,
    undefined,
    createInitialState,
  );
  const [selectedComponentId, setSelectedComponentId] = useState<string | null>(
    null,
  );
  const [fromComponentId, setFromComponentId] = useState<string>('');
  const [fromOutputKey, setFromOutputKey] = useState<string>('');
  const [toComponentId, setToComponentId] = useState<string>('');
  const [toInputKey, setToInputKey] = useState<string>('');

  const selectedComponent = useMemo(
    () =>
      selectedComponentId
        ? (state.components.find(
            (component) => component.id === selectedComponentId,
          ) ?? null)
        : null,
    [selectedComponentId, state.components],
  );

  useEffect(() => {
    const timer = window.setInterval(() => {
      dispatch({ type: 'tick' });
    }, LOOP_MS);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!selectedComponentId) {
      return;
    }

    const exists = state.components.some(
      (component) => component.id === selectedComponentId,
    );
    if (!exists) {
      setSelectedComponentId(null);
    }
  }, [selectedComponentId, state.components]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== 'Delete' ||
        !selectedComponentId ||
        document.activeElement?.tagName === 'TEXTAREA'
      ) {
        return;
      }

      dispatch({ type: 'delete-component', id: selectedComponentId });
      setSelectedComponentId(null);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedComponentId]);

  const outputComponents = useMemo(
    () =>
      state.components.filter(
        (component) => getOutputKeys(component).length > 0,
      ),
    [state.components],
  );

  const inputComponents = useMemo(
    () =>
      state.components.filter(
        (component) => getInputKeys(component).length > 0,
      ),
    [state.components],
  );

  const selectedFrom = useMemo(
    () =>
      state.components.find((component) => component.id === fromComponentId) ??
      null,
    [fromComponentId, state.components],
  );

  const selectedTo = useMemo(
    () =>
      state.components.find((component) => component.id === toComponentId) ??
      null,
    [toComponentId, state.components],
  );

  const fromOutputOptions = selectedFrom ? getOutputKeys(selectedFrom) : [];
  const toInputOptions = selectedTo ? getInputKeys(selectedTo) : [];

  const handlePaletteDragStart = (
    event: React.DragEvent<HTMLButtonElement>,
    type: ComponentType,
  ) => {
    event.dataTransfer.setData('application/component-type', type);
  };

  const handleDeleteSelected = () => {
    if (!selectedComponentId) {
      return;
    }

    dispatch({ type: 'delete-component', id: selectedComponentId });
    setSelectedComponentId(null);
  };

  const handleAddConnection = () => {
    if (!fromComponentId || !fromOutputKey || !toComponentId || !toInputKey) {
      return;
    }

    dispatch({
      type: 'add-connection',
      connection: {
        fromComponentId,
        outputKey: fromOutputKey,
        toComponentId,
        inputKey: toInputKey,
      },
    });

    // Apply one immediate simulation step so connected visuals reflect current signals.
    dispatch({ type: 'tick' });
  };

  return (
    <main className="layout">
      <aside className="sidebar">
        <h2>Components</h2>
        <p>Drag into 3D scene</p>
        {paletteItems.map((item) => (
          <button
            key={item.type}
            type="button"
            className="palette-item"
            draggable
            onDragStart={(event) => handlePaletteDragStart(event, item.type)}
          >
            {item.label}
          </button>
        ))}
      </aside>

      <section className="canvas-wrap">
        <header className="canvas-header">
          <h1>3D Circuit Simulator</h1>
          <p>
            Tick: {state.tickCount} | Time: {state.timeSeconds.toFixed(1)}s |
            Components: {state.components.length} | Connections:{' '}
            {state.connections.length}
          </p>
          <p className="hint">
            Click to select, drag to move, Shift + drag to rotate, Delete to
            remove, use mouse to orbit.
          </p>
        </header>

        <SimulationScene3D
          components={state.components}
          selectedId={selectedComponentId}
          onSelect={setSelectedComponentId}
          onAddComponent={(type, position) =>
            dispatch({ type: 'add-component', componentType: type, position })
          }
          onMoveComponent={(id, position) =>
            dispatch({ type: 'move-component', id, position })
          }
          onRotateComponent={(id, rotationY) =>
            dispatch({ type: 'rotate-component', id, rotationY })
          }
          onToggleSwitch={(id) => {
            dispatch({ type: 'toggle-switch', id });
            dispatch({ type: 'tick' });
          }}
        />
      </section>

      <aside className="editor-panel">
        <h2>Code Editor</h2>
        {selectedComponent?.type === 'programmable' ||
        selectedComponent?.type === 'trafficController' ? (
          <>
            <p>
              <strong>{selectedComponent.type}</strong>: {selectedComponent.id}
            </p>
            <textarea
              value={selectedComponent.code ?? ''}
              onChange={(event) =>
                dispatch({
                  type: 'set-program-code',
                  id: selectedComponent.id,
                  code: event.target.value,
                })
              }
            />
            {selectedComponent.lastError ? (
              <p className="error-text">
                Runtime error: {selectedComponent.lastError}
              </p>
            ) : (
              <p className="ok-text">Code running without errors.</p>
            )}
          </>
        ) : selectedComponent ? (
          <p>
            <strong>{selectedComponent.type}</strong>: {selectedComponent.id}
          </p>
        ) : (
          <p>
            Select a Programmable or Traffic Controller component to edit its
            logic.
          </p>
        )}

        <div className="pending-text">
          <p>
            Selected:{' '}
            {selectedComponentId ? (
              <strong>{selectedComponentId}</strong>
            ) : (
              'none'
            )}
          </p>
          <button
            type="button"
            className="delete-btn"
            onClick={handleDeleteSelected}
            disabled={!selectedComponentId}
          >
            Delete Selected
          </button>
        </div>

        <div className="connection-builder">
          <h3>Add Connection</h3>
          <label>
            From component
            <select
              value={fromComponentId}
              onChange={(event) => {
                setFromComponentId(event.target.value);
                setFromOutputKey('');
              }}
            >
              <option value="">Select source</option>
              {outputComponents.map((component) => (
                <option key={component.id} value={component.id}>
                  {component.id}
                </option>
              ))}
            </select>
          </label>

          <label>
            Output key
            <select
              value={fromOutputKey}
              onChange={(event) => setFromOutputKey(event.target.value)}
              disabled={!fromComponentId}
            >
              <option value="">Select output</option>
              {fromOutputOptions.map((key) => (
                <option key={key} value={key}>
                  {key}
                </option>
              ))}
            </select>
          </label>

          <label>
            To component
            <select
              value={toComponentId}
              onChange={(event) => {
                setToComponentId(event.target.value);
                setToInputKey('');
              }}
            >
              <option value="">Select destination</option>
              {inputComponents.map((component) => (
                <option key={component.id} value={component.id}>
                  {component.id}
                </option>
              ))}
            </select>
          </label>

          <label>
            Input key
            <select
              value={toInputKey}
              onChange={(event) => setToInputKey(event.target.value)}
              disabled={!toComponentId}
            >
              <option value="">Select input</option>
              {toInputOptions.map((key) => (
                <option key={key} value={key}>
                  {key}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            className="connect-btn"
            onClick={handleAddConnection}
          >
            Connect
          </button>
        </div>

        <div className="connection-list">
          <h3>Connections</h3>
          {state.connections.length === 0 ? <p>None yet.</p> : null}
          {state.connections.map((connection, index) => (
            <p
              key={`${connection.fromComponentId}-${connection.toComponentId}-${index}`}
            >
              {connection.fromComponentId}.{connection.outputKey} -&gt;{' '}
              {connection.toComponentId}.{connection.inputKey}
            </p>
          ))}
        </div>
      </aside>
    </main>
  );
}

export default App;
