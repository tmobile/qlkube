import { useState, createContext, useEffect } from 'react';
export const QlkubeContext = createContext();

const QlkubeProvider = ({ children, wsUrl, queryUrl }) => {
  const [ws, setWs] = useState(null);
  const [socketState, setSocketState] = useState(null);
  const [qlkubeSocketStatus, setQlkubeSocketStatus]= useState(null);

  const addSocketToReconnect = (newNsMap) => {};
  const reconnect = async() => {
    if(ws){
      await ws?.close()
    }
  }
  const updateQlkubeSocketStatus = (stat) => {
    setQlkubeSocketStatus(stat)
  }
  useEffect(() => {
    connectWs();
  }, [])

  const connectWs = async() => {
    if(ws){
      await ws?.close()
    }
    const _ws = new WebSocket(wsUrl);

    setWs(prev => prev = _ws);
    _ws.onopen = function() {
      setSocketState(true)
    };
    _ws.onclose = function(e) {
      setSocketState(false)
      setTimeout(function() {
        connectWs();
      }, 1000);
    };
    _ws.onerror = function(err) {}
  }

  return (
    <QlkubeContext.Provider
      value={{
        ws,
        socketState,
        qlkubeSocketStatus,
        qlkubeUrl: queryUrl,
        qlkubeUrl_ws: wsUrl,
        reconnect,
        updateQlkubeSocketStatus
      }}
    >
      {children}
    </QlkubeContext.Provider>
  );
};

export default QlkubeProvider;
