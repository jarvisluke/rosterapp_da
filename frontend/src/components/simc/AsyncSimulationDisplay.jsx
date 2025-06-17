import { useState, useEffect, useRef } from 'react';
import SimulationReport from './SimulationReport';

function AsyncSimulationDisplay({ simcInput, onClose, onComplete }) {
  const [status, setStatus] = useState(null);
  const [queuePosition, setQueuePosition] = useState(null);
  const [estimatedWait, setEstimatedWait] = useState(null);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const wsRef = useRef(null);

  useEffect(() => {
    if (!simcInput) {
      setError("No simulation input provided");
      return;
    }

    // Build WebSocket URL, adjust the host if needed
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${protocol}://${window.location.host}/api/simulate/stream`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('WebSocket connected');

      // Send the initial message with base64 encoded simc_input
      const payload = {
        simc_input: btoa(simcInput)  // encode UTF-8 string to base64
      };
      ws.send(JSON.stringify(payload));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // The backend sends {type, content, ...}
        // Map backend data to frontend state updates

        if (data.type === 'error') {
          setError(data.content || "Simulation error");
          return;
        }

        if (data.type === 'status') {
          setStatus(data.content);
          return;
        }

        if (data.type === 'queue_position') {
          setQueuePosition(data.content);
          return;
        }

        if (data.type === 'estimated_wait') {
          setEstimatedWait(data.content);
          return;
        }

        if (data.type === 'result') {
          setStatus('COMPLETED');
          setResult(data.content);
          onComplete(data.content);
          return;
        }

        // Optionally handle other types like logs or partial output here
        // e.g. console.log('Log:', data.content);

      } catch (err) {
        console.error('Error parsing WebSocket message:', err);
        setError('Error receiving simulation updates');
      }
    };

    ws.onerror = (event) => {
      console.error('WebSocket error:', event);
      setError('WebSocket connection error');
    };

    ws.onclose = (event) => {
      console.log('WebSocket closed', event);
      if (status !== 'COMPLETED' && !error) {
        setError('Connection lost');
      }
    };

    return () => {
      ws.close();
    };
  }, [simcInput, onComplete]);

  const formatWaitTime = (seconds) => {
    if (!seconds) return null;
    if (seconds < 60) return `${seconds} seconds`;
    if (seconds < 3600) {
      const minutes = Math.floor(seconds / 60);
      return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
    }
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours} hour${hours !== 1 ? 's' : ''} ${minutes} minute${minutes !== 1 ? 's' : ''}`;
  };

  if (error) {
    return (
      <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
        <div className="modal-dialog modal-dialog-centered">
          <div className="modal-content">
            <div className="modal-header bg-danger text-white">
              <h5 className="modal-title">Simulation Error</h5>
              <button type="button" className="btn-close" onClick={onClose}></button>
            </div>
            <div className="modal-body">
              <p className="text-danger">{error}</p>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'COMPLETED' && result) {
    return <SimulationReport htmlContent={result} onClose={onClose} />;
  }

  return (
    <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="modal-dialog modal-dialog-centered">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">Simulation in Progress</h5>
            <button type="button" className="btn-close" onClick={onClose}></button>
          </div>
          <div className="modal-body text-center">
            <div className="mb-3">
              <div className="spinner-border text-primary" role="status">
                <span className="visually-hidden">Loading...</span>
              </div>
            </div>
            <h6>Status: {status || 'Starting...'}</h6>
            {queuePosition > 0 && <p>Queue Position: {queuePosition}</p>}
            {estimatedWait && <p>Estimated Wait: {formatWaitTime(estimatedWait)}</p>}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AsyncSimulationDisplay;
