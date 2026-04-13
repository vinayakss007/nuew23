"use client"

import { useState, useCallback } from 'react'
import { Plus, Play, Pause, Archive, Trash2, Edit, Copy, Settings, Zap, Mail, Calendar, Phone, Tag, User, Globe, Clock, GitBranch } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import toast from 'react-hot-toast'

interface WorkflowAction {
  id?: string
  action_order: number
  action_type: string
  action_config: any
  condition_type: string
  condition_config: any
}

interface Workflow {
  id: string
  name: string
  description: string
  trigger_type: string
  trigger_config: any
  nodes: any[]
  actions: WorkflowAction[]
  status: 'draft' | 'active' | 'paused' | 'archived'
}

interface WorkflowBuilderProps {
  workflow?: Workflow
  onSave: (workflow: Partial<Workflow>) => Promise<void>
  onCancel: () => void
}

const TRIGGER_TYPES = [
  { value: 'contact.created', label: 'Contact Created', icon: User },
  { value: 'contact.updated', label: 'Contact Updated', icon: User },
  { value: 'contact.lifecycle_stage_changed', label: 'Lifecycle Changed', icon: GitBranch },
  { value: 'deal.created', label: 'Deal Created', icon: Zap },
  { value: 'deal.stage_changed', label: 'Deal Stage Changed', icon: GitBranch },
  { value: 'deal.won', label: 'Deal Won', icon: Zap },
  { value: 'task.completed', label: 'Task Completed', icon: Calendar },
  { value: 'form.submitted', label: 'Form Submitted', icon: Mail },
]

const ACTION_TYPES = [
  { value: 'send_email', label: 'Send Email', icon: Mail, color: 'text-blue-600' },
  { value: 'create_task', label: 'Create Task', icon: Calendar, color: 'text-violet-600' },
  { value: 'add_tag', label: 'Add Tag', icon: Tag, color: 'text-pink-600' },
  { value: 'update_contact', label: 'Update Contact', icon: User, color: 'text-green-600' },
  { value: 'assign_contact', label: 'Assign Contact', icon: User, color: 'text-amber-600' },
  { value: 'send_webhook', label: 'Send Webhook', icon: Globe, color: 'text-indigo-600' },
  { value: 'wait', label: 'Wait', icon: Clock, color: 'text-gray-600' },
]

export function WorkflowBuilder({ workflow, onSave, onCancel }: WorkflowBuilderProps) {
  const [name, setName] = useState(workflow?.name || '')
  const [description, setDescription] = useState(workflow?.description || '')
  const [triggerType, setTriggerType] = useState(workflow?.trigger_type || '')
  const [actions, setActions] = useState<WorkflowAction[]>(workflow?.actions || [])
  const [saving, setSaving] = useState(false)
  const [expandedAction, setExpandedAction] = useState<number | null>(null)

  const addAction = (actionType: string) => {
    const newAction: WorkflowAction = {
      action_order: actions.length + 1,
      action_type: actionType,
      action_config: {},
      condition_type: 'always',
      condition_config: {},
    }
    setActions([...actions, newAction])
    setExpandedAction(actions.length)
  }

  const updateAction = (index: number, updates: Partial<WorkflowAction>) => {
    const newActions = [...actions]
    newActions[index] = { ...newActions[index]!, ...updates }
    setActions(newActions)
  }

  const deleteAction = (index: number) => {
    const newActions = actions.filter((_, i) => i !== index)
    newActions.forEach((action, i) => {
      action.action_order = i + 1
    })
    setActions(newActions)
  }

  const moveAction = (index: number, direction: 'up' | 'down') => {
    if ((direction === 'up' && index === 0) || 
        (direction === 'down' && index === actions.length - 1)) {
      return
    }
    const newActions = [...actions]
    const temp = newActions[index]!
    const swapIndex = direction === 'up' ? index - 1 : index + 1
    newActions[index] = newActions[swapIndex]!
    newActions[swapIndex] = temp
    newActions.forEach((action, i) => {
      action.action_order = i + 1
    })
    setActions(newActions)
  }

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Workflow name is required')
      return
    }
    if (!triggerType) {
      toast.error('Trigger type is required')
      return
    }
    if (actions.length === 0) {
      toast.error('At least one action is required')
      return
    }

    setSaving(true)
    try {
      await onSave({
        name,
        description,
        trigger_type: triggerType,
        actions,
      })
      toast.success('Workflow saved!')
    } catch (error: any) {
      toast.error(error.message || 'Failed to save workflow')
    }
    setSaving(false)
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">
            {workflow ? 'Edit Workflow' : 'Create Workflow'}
          </h2>
          <p className="text-sm text-muted-foreground">
            Build automated workflows with triggers and actions
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Workflow'}
          </Button>
        </div>
      </div>

      {/* Basic Info */}
      <div className="admin-card p-5 space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1.5">Workflow Name *</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., New Lead Follow-up"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5">Description</label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe what this workflow does"
          />
        </div>
      </div>

      {/* Trigger */}
      <div className="admin-card p-5 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <Zap className="w-5 h-5 text-amber-600" />
          <h3 className="text-sm font-bold">Trigger</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          When should this workflow run?
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {TRIGGER_TYPES.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              onClick={() => setTriggerType(value)}
              className={cn(
                'p-3 rounded-lg border text-left transition-all',
                triggerType === value
                  ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/20'
                  : 'border-border hover:border-amber-300'
              )}
            >
              <Icon className={cn('w-4 h-4 mb-1.5', triggerType === value ? 'text-amber-600' : 'text-muted-foreground')} />
              <div className="text-xs font-medium">{label}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold">Actions</h3>
          <div className="flex items-center gap-2">
            {ACTION_TYPES.map(({ value, label, icon: Icon, color }) => (
              <Button
                key={value}
                variant="outline"
                size="sm"
                onClick={() => addAction(value)}
                className="text-xs"
              >
                <Icon className={cn('w-3.5 h-3.5 mr-1.5', color)} />
                {label}
              </Button>
            ))}
          </div>
        </div>

        {actions.length === 0 ? (
          <div className="admin-card p-12 text-center">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
              <Zap className="w-8 h-8 text-muted-foreground" />
            </div>
            <h4 className="text-sm font-semibold mb-1">No actions yet</h4>
            <p className="text-sm text-muted-foreground mb-4">
              Add actions to define what happens when the trigger fires
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {actions.map((action, index) => {
              const ActionIcon = ACTION_TYPES.find(t => t.value === action.action_type)?.icon || Zap
              const actionColor = ACTION_TYPES.find(t => t.value === action.action_type)?.color || 'text-gray-600'

              return (
                <div key={action.id || index} className="admin-card overflow-hidden">
                  <div className="flex items-center gap-3 p-4 border-b border-border bg-muted/30">
                    <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', actionColor.replace('text-', 'bg-').replace('600', '100'))}>
                      <ActionIcon className={cn('w-4 h-4', actionColor)} />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-muted-foreground">Action {action.action_order}</span>
                        <Badge variant="outline" className="text-xs capitalize">{action.action_type.replace('_', ' ')}</Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => moveAction(index, 'up')} disabled={index === 0}>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                        </svg>
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => moveAction(index, 'down')} disabled={index === actions.length - 1}>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setExpandedAction(expandedAction === index ? null : index)}>
                        <svg className={cn('w-4 h-4 transition-transform', expandedAction === index && 'rotate-180')} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600" onClick={() => deleteAction(index)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>

                  {expandedAction === index && (
                    <div className="p-4 space-y-4">
                      {/* Action configuration would go here */}
                      <p className="text-sm text-muted-foreground">
                        Configure {action.action_type} settings...
                      </p>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Summary */}
      {actions.length > 0 && (
        <div className="admin-card p-4 bg-muted/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 text-sm">
              <span>Trigger: <strong className="capitalize">{triggerType.replace(/_/g, ' ')}</strong></span>
              <span>Actions: <strong>{actions.length}</strong></span>
            </div>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save Workflow'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
