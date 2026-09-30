import { useState, useEffect, useCallback } from "react";
import Sidebar from "../components/Sidebar";
import ChatPanel from "../components/ChatPanel";
import RightPanel from "../components/RightPanel";
import api from "../lib/api";

const EMPTY_BG = "https://images.unsplash.com/photo-1578662996442-48f60103fc96";

export default function Workspace() {
  const [conversations, setConversations] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [providers, setProviders] = useState({});
  const [modelStatus, setModelStatus] = useState({});
  const [provider, setProvider] = useState("openai");
  const [model, setModel] = useState("gpt-4o-mini");
  const [activeTool, setActiveTool] = useState(null);

  const refreshConversations = useCallback(() => {
    api.get("/conversations").then((r) => setConversations(r.data));
  }, []);

  useEffect(() => {
    refreshConversations();
    api.get("/models").then((r) => setProviders(r.data));
    api.get("/models/status").then((r) => setModelStatus(r.data)).catch(() => {});
    api.get("/auth/me").then((r) => {
      if (r.data.provider) setProvider(r.data.provider);
      if (r.data.model) setModel(r.data.model);
    }).catch(() => {});
  }, [refreshConversations]);

  const onNew = () => {
    setCurrentId(null);
  };

  const onDelete = async (id) => {
    await api.delete(`/conversations/${id}`);
    if (currentId === id) setCurrentId(null);
    refreshConversations();
  };

  const onSelect = (id) => {
    setCurrentId(id);
    const c = conversations.find((x) => x.id === id);
    if (c?.provider) setProvider(c.provider);
    if (c?.model) setModel(c.model);
  };

  return (
    <div className="h-screen flex overflow-hidden relative">
      <div
        className="absolute inset-0 opacity-[0.04] bg-cover bg-center pointer-events-none"
        style={{ backgroundImage: `url(${EMPTY_BG})` }}
        aria-hidden
      />
      <Sidebar
        conversations={conversations}
        currentId={currentId}
        onSelect={onSelect}
        onNew={onNew}
        onDelete={onDelete}
        activeTool={activeTool}
        setActiveTool={setActiveTool}
      />
      <div className="flex-1 flex min-w-0 relative z-10">
        <ChatPanel
          conversationId={currentId}
          setConversationId={setCurrentId}
          providers={providers}
          modelStatus={modelStatus}
          provider={provider}
          model={model}
          onModelChange={(p, m) => {
            setProvider(p);
            setModel(m);
            api.put("/settings", { provider: p, model: m }).catch(() => {});
          }}
          refreshConversations={refreshConversations}
        />
        {activeTool && <RightPanel tool={activeTool} onClose={() => setActiveTool(null)} />}
      </div>
    </div>
  );
}
