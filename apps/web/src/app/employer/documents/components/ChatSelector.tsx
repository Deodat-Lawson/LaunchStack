import React, { useState, useEffect, useRef } from 'react';
import { Plus, MessageSquare, Trash2, Edit2, Check, X } from 'lucide-react';
import { useAIChatbot } from '../hooks/useAIChatbot';

interface Chat {
  id: string;
  title: string;
  createdAt: string;
  status: 'active' | 'completed' | 'paused' | 'failed';
}

interface ChatSelectorProps {
  userId: string;
  currentChatId: string | null;
  onSelectChat: (chatId: string | null) => void;
  onNewChat: () => void;
}

export const ChatSelector: React.FC<ChatSelectorProps> = ({
  userId,
  currentChatId,
  onSelectChat,
  onNewChat,
}) => {
  const { getChats, deleteChat, updateChat, loading } = useAIChatbot();
  const [chats, setChats] = useState<Chat[]>([]);
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);

  const loadChats = React.useCallback(async () => {
    const fetchedChats = await getChats(userId);
    setChats(fetchedChats);
  }, [getChats, userId]);

  useEffect(() => {
    if (userId) {
      void loadChats();
    }
  }, [userId, currentChatId, loadChats]); // Reload when chat changes

  const handleDelete = async (chatId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm('Delete this chat? This action cannot be undone.')) {
      const success = await deleteChat(chatId);
      if (success) {
        setChats(chats.filter(c => c.id !== chatId));
        if (currentChatId === chatId) {
          onSelectChat(null);
        }
      }
    }
  };

  const handleSelectChat = (chatId: string) => {
    if (editingChatId !== chatId) {
      onSelectChat(chatId);
    }
  };

  const handleStartEdit = (chat: Chat, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingChatId(chat.id);
    setEditTitle(chat.title);
    setTimeout(() => {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }, 0);
  };

  const handleSaveEdit = async (chatId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!editTitle.trim()) {
      setEditingChatId(null);
      return;
    }
    
    const updated = await updateChat(chatId, { title: editTitle.trim() });
    if (updated) {
      setChats(chats.map(c => c.id === chatId ? { ...c, title: editTitle.trim() } : c));
    }
    setEditingChatId(null);
  };

  const handleCancelEdit = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setEditingChatId(null);
    setEditTitle('');
  };

  return (
    <div className="flex flex-col h-full">
      {/* New Chat Button */}
      <div className="mb-4">
        <button
          onClick={onNewChat}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-lg hover:from-purple-700 hover:to-indigo-700 transition-all shadow-md"
        >
          <Plus className="w-5 h-5" />
          <span className="font-medium">New Chat</span>
        </button>
      </div>

      {/* Chat List */}
      <div className="flex-1 overflow-y-auto space-y-2">
        {loading ? (
          <div className="text-center py-8 text-muted-foreground">
            Loading chats...
          </div>
        ) : chats.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <MessageSquare className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No chats yet</p>
            <p className="text-xs mt-1">Create your first chat to get started</p>
          </div>
        ) : (
          chats.map((chat) => (
            <div
              key={chat.id}
              onClick={() => handleSelectChat(chat.id)}
              className={`
                flex items-center justify-between p-3 rounded-lg cursor-pointer transition-all
                ${
                  currentChatId === chat.id
                    ? 'bg-purple-100 dark:bg-purple-900/30 border-2 border-purple-600 shadow-sm'
                    : 'bg-muted/50 hover:bg-muted border-2 border-transparent'
                }
              `}
            >
              <div className="flex-1 min-w-0">
                {editingChatId === chat.id ? (
                  <div className="flex items-center gap-2">
                    <input
                      ref={editInputRef}
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          void handleSaveEdit(chat.id);
                        } else if (e.key === 'Escape') {
                          handleCancelEdit();
                        }
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="flex-1 px-2 py-1 text-sm font-medium text-foreground bg-background border border-purple-500 rounded focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                    <button
                      onClick={(e) => handleSaveEdit(chat.id, e)}
                      className="p-1 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded transition-colors"
                      title="Save"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => handleCancelEdit(e)}
                      className="p-1 text-muted-foreground hover:bg-muted rounded transition-colors"
                      title="Cancel"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <>
                    <p className="font-medium text-sm text-foreground truncate">
                      {chat.title}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {new Date(chat.createdAt).toLocaleDateString()}
                    </p>
                  </>
                )}
              </div>
              {editingChatId !== chat.id && (
                <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                  <button
                    onClick={(e) => handleStartEdit(chat, e)}
                    className="p-1.5 text-muted-foreground hover:text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-900/20 rounded-lg transition-colors"
                    title="Edit title"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={(e) => handleDelete(chat.id, e)}
                    className="p-1.5 text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                    title="Delete chat"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

