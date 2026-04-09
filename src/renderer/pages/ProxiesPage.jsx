import React, { useState, useEffect } from 'react';
import { Network, Plus, Copy, Check, Edit2, Trash2 } from 'lucide-react';

export default function ProxiesPage() {
  const [proxyBulks, setProxyBulks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingBulk, setEditingBulk] = useState(null);
  const [copiedId, setCopiedId] = useState(null);

  useEffect(() => {
    loadProxyBulks();
  }, []);

  const loadProxyBulks = async () => {
    try {
      setLoading(true);
      const data = await window.api.listProxyBulks();
      setProxyBulks(data || []);
    } catch (err) {
      console.error('Failed to load proxy bulks', err);
      setProxyBulks([]);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this proxy bulk?')) return;
    try {
      await window.api.deleteProxyBulk(id);
      await loadProxyBulks();
    } catch (err) {
      console.error('Failed to delete proxy bulk', err);
      alert('Failed to delete proxy bulk');
    }
  };

  const handleCopyId = (id) => {
    navigator.clipboard?.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">Loading...</div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-gradient-to-br from-neutral-950 via-neutral-900 to-neutral-950">
      <div className="border-b border-white/10 bg-gradient-to-r from-neutral-950/90 to-neutral-900/90 backdrop-blur-xl">
        <div className="px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center shadow-lg shadow-green-500/25">
                  <Network className="w-5 h-5 text-white" />
                </div>
                <h1 className="text-2xl font-bold bg-gradient-to-r from-white to-neutral-300 bg-clip-text text-transparent">
                  Proxy Management
                </h1>
              </div>
              <p className="text-sm text-neutral-400 ml-[52px]">Manage your proxy bulks for anonymous repository creation</p>
            </div>
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-xl hover:shadow-lg hover:shadow-green-500/25 transition-all duration-200 hover:scale-105 font-medium"
            >
              <Plus className="w-4 h-4" />
              Create Proxy Bulk
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-8">
        {proxyBulks.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center max-w-md">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-green-500/20 to-emerald-600/20 flex items-center justify-center mx-auto mb-6">
                <Network className="w-10 h-10 text-green-400" />
              </div>
              <h3 className="text-xl font-semibold text-white mb-2">No Proxy Bulks Yet</h3>
              <p className="text-neutral-400 mb-6">Create your first proxy bulk to start using proxies for GitHub operations</p>
              <button
                onClick={() => setShowCreateModal(true)}
                className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-xl hover:shadow-lg hover:shadow-green-500/25 transition-all duration-200 hover:scale-105 font-medium"
              >
                <Plus className="w-4 h-4" />
                Create Proxy Bulk
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
            {proxyBulks.map((bulk) => (
              <ProxyBulkCard
                key={bulk.id}
                bulk={bulk}
                onDelete={handleDelete}
                onEdit={setEditingBulk}
                onCopyId={handleCopyId}
                isCopied={copiedId === bulk.id}
              />
            ))}
          </div>
        )}
      </div>

      {(showCreateModal || editingBulk) && (
        <ProxyBulkModal
          bulk={editingBulk}
          onClose={() => { setShowCreateModal(false); setEditingBulk(null); }}
          onSuccess={() => { setShowCreateModal(false); setEditingBulk(null); loadProxyBulks(); }}
        />
      )}
    </div>
  );
}

function ProxyBulkCard({ bulk, onDelete, onEdit, onCopyId, isCopied }) {
  const proxyCount = bulk.proxies?.length || 0;
  const createdDate = bulk.createdAt ? new Date(bulk.createdAt).toLocaleDateString() : 'N/A';

  return (
    <div className="group relative bg-gradient-to-br from-neutral-900/50 to-neutral-800/30 backdrop-blur-xl border border-white/10 rounded-2xl p-6 hover:border-green-500/30 transition-all duration-300 hover:shadow-xl hover:shadow-green-500/10">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-green-500/20 to-emerald-600/20 flex items-center justify-center border border-green-500/20">
            <Network className="w-6 h-6 text-green-400" />
          </div>
          <div>
            <h3 className="font-semibold text-white mb-1">{bulk.name}</h3>
            <div className="flex items-center gap-2">
              <span className="text-xs text-neutral-500">ID:</span>
              <button
                onClick={() => onCopyId(bulk.id)}
                className="text-xs text-neutral-400 hover:text-white transition-colors font-mono flex items-center gap-1"
              >
                {bulk.id.substring(0, 8)}...
                {isCopied ? (
                  <Check className="w-3 h-3 text-green-400" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-3 mb-4">
        <div className="flex items-center justify-between py-2 px-3 bg-white/5 rounded-lg">
          <span className="text-sm text-neutral-400">Proxies</span>
          <span className="text-sm font-semibold text-green-400">{proxyCount}</span>
        </div>
        <div className="flex items-center justify-between py-2 px-3 bg-white/5 rounded-lg">
          <span className="text-sm text-neutral-400">Created</span>
          <span className="text-sm font-medium text-neutral-300">{createdDate}</span>
        </div>
      </div>

      {bulk.description && (
        <p className="text-sm text-neutral-400 mb-4 line-clamp-2">{bulk.description}</p>
      )}

      <div className="flex gap-2 pt-4 border-t border-white/5">
        <button
          onClick={() => onEdit(bulk)}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-500/10 text-blue-400 rounded-lg hover:bg-blue-500/20 transition-all duration-200 text-sm font-medium"
        >
          <Edit2 className="w-3.5 h-3.5" />
          Edit
        </button>
        <button
          onClick={() => onDelete(bulk.id)}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-red-500/10 text-red-400 rounded-lg hover:bg-red-500/20 transition-all duration-200 text-sm font-medium"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Delete
        </button>
      </div>
    </div>
  );
}

function ProxyBulkModal({ bulk, onClose, onSuccess }) {
  const [formData, setFormData] = useState({
    name: bulk?.name || '',
    description: bulk?.description || '',
    proxies: bulk?.proxies?.join('\n') || '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const proxies = formData.proxies.split('\n').map(p => p.trim()).filter(p => p.length > 0);
    if (!formData.name.trim()) {
      setError('Name is required');
      return;
    }

    try {
      setLoading(true);
      if (bulk && bulk.id) {
        await window.api.updateProxyBulk(bulk.id, { name: formData.name.trim(), description: formData.description.trim(), proxies });
      } else {
        await window.api.createProxyBulk({ name: formData.name.trim(), description: formData.description.trim(), proxies });
      }
      onSuccess();
    } catch (err) {
      console.error('Failed to save proxy bulk', err);
      setError(err?.message || 'Failed to save');
    } finally {
      setLoading(false);
    }
  };

  const proxyCount = formData.proxies.split('\n').filter(p => p.trim().length > 0).length;

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/60 z-50">
      <div className="w-full max-w-2xl bg-neutral-900 rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">{bulk ? 'Edit Proxy Bulk' : 'Create Proxy Bulk'}</h3>
          <button onClick={onClose} className="text-neutral-400">Close</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <input value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="Bulk name" className="p-3 rounded-lg bg-neutral-800 text-white w-full" />
            <input value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} placeholder="Short description" className="p-3 rounded-lg bg-neutral-800 text-white w-full" />
          </div>
          <div className="mb-4">
            <label className="text-sm text-neutral-400 mb-2 block">Proxies (one per line)</label>
            <textarea value={formData.proxies} onChange={(e) => setFormData({ ...formData, proxies: e.target.value })} rows={8} className="w-full p-3 rounded-lg bg-neutral-800 text-white" />
            <div className="text-xs text-neutral-500 mt-2">{proxyCount} proxies</div>
          </div>

          {error && <div className="text-sm text-red-400 mb-2">{error}</div>}

          <div className="flex items-center justify-end gap-3">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg bg-white/5 text-neutral-300">Cancel</button>
            <button type="submit" disabled={loading} className="px-6 py-2 rounded-lg bg-green-600 text-white">{loading ? 'Saving...' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
