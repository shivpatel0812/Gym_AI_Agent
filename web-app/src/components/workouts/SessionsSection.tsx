'use client';

import { useState, useEffect } from 'react';
import apiClient from '@/lib/api-client';
import { WorkoutSession, Exercise, Split, SessionExercise, WorkoutSet } from '@/types';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import { MdAdd, MdDelete, MdFitnessCenter, MdClose, MdEdit } from 'react-icons/md';

interface SessionsSectionProps {
  exercises: Exercise[];
  splits: Split[];
  editSessionId?: string | null;
}

export default function SessionsSection({ exercises, splits, editSessionId: propEditSessionId }: SessionsSectionProps) {
  const [sessions, setSessions] = useState<WorkoutSession[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [formData, setFormData] = useState<{
    date: string;
    split_id: string;
    split_name: string;
    exercises: SessionExercise[];
    notes: string;
  }>({
    date: new Date().toISOString().split('T')[0],
    split_id: '',
    split_name: '',
    exercises: [],
    notes: ''
  });
  const [currentExercise, setCurrentExercise] = useState({
    exercise_id: '',
    exercise_name: '',
    sets: [] as WorkoutSet[]
  });
  const [currentSet, setCurrentSet] = useState({ reps: '', weight: '' });

  useEffect(() => {
    fetchSessions();
  }, []);

  useEffect(() => {
    if (propEditSessionId && sessions.length > 0) {
      const sessionToEdit = sessions.find(s => s.id === propEditSessionId);
      if (sessionToEdit) {
        setFormData({
          date: sessionToEdit.date,
          split_id: sessionToEdit.split_id || '',
          split_name: sessionToEdit.split_name || '',
          exercises: sessionToEdit.exercises || [],
          notes: sessionToEdit.notes || ''
        });
        setEditingSessionId(sessionToEdit.id || null);
        setShowForm(true);
      }
    }
  }, [propEditSessionId, sessions]);

  const fetchSessions = async () => {
    try {
      const res = await apiClient.get('/api/workout-sessions');
      setSessions(res.data);
    } catch (error) {
      console.error('Error fetching sessions:', error);
    }
  };

  const addSet = () => {
    if (currentSet.reps) {
      const newSet: WorkoutSet = {
        set_number: currentExercise.sets.length + 1,
        reps: parseInt(currentSet.reps),
        weight: currentSet.weight ? parseFloat(currentSet.weight) : undefined
      };
      setCurrentExercise({
        ...currentExercise,
        sets: [...currentExercise.sets, newSet]
      });
      setCurrentSet({ reps: '', weight: '' });
    }
  };

  const addExerciseToSession = () => {
    if (currentExercise.exercise_id && currentExercise.sets.length > 0) {
      setFormData({
        ...formData,
        exercises: [...formData.exercises, { ...currentExercise }]
      });
      setCurrentExercise({ exercise_id: '', exercise_name: '', sets: [] });
    }
  };

  const handleExerciseChange = (exerciseId: string) => {
    const exercise = exercises.find(e => e.id === exerciseId);
    if (exercise) {
      setCurrentExercise({
        ...currentExercise,
        exercise_id: exerciseId,
        exercise_name: exercise.name
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        date: formData.date,
        split_name: formData.split_name || undefined,
        exercises: formData.exercises,
        notes: formData.notes || undefined,
      };

      if (editingSessionId) {
        await apiClient.put(`/api/workout-sessions/${editingSessionId}`, payload);
      } else {
        await apiClient.post('/api/workout-sessions', payload);
      }
      
      resetForm();
      fetchSessions();
    } catch (error) {
      console.error('Error saving session:', error);
    }
  };

  const resetForm = () => {
    setFormData({
      date: new Date().toISOString().split('T')[0],
      split_id: '',
      split_name: '',
      exercises: [],
      notes: ''
    });
    setCurrentExercise({ exercise_id: '', exercise_name: '', sets: [] });
    setCurrentSet({ reps: '', weight: '' });
    setEditingSessionId(null);
    setShowForm(false);
  };

  const handleCancel = () => {
    resetForm();
  };

  const handleEdit = (session: WorkoutSession) => {
    setFormData({
      date: session.date,
      split_id: session.split_id || '',
      split_name: session.split_name || '',
      exercises: session.exercises || [],
      notes: session.notes || ''
    });
    setEditingSessionId(session.id || null);
    setShowForm(true);
  };

  const handleDelete = async (sessionId: string) => {
    if (confirm('Are you sure you want to delete this workout session?')) {
      try {
        await apiClient.delete(`/api/workout-sessions/${sessionId}`);
        fetchSessions();
      } catch (error) {
        console.error('Error deleting session:', error);
      }
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-8">
        <h2 className="text-2xl font-bold text-[#F9FAFB]">Workout Sessions</h2>
        <Button onClick={() => setShowForm(true)} icon={<MdAdd />}>
          Log Workout
        </Button>
      </div>

      {showForm && (
        <Card className="mb-8 p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-semibold text-[#F9FAFB]">
              {editingSessionId ? 'Edit Workout Session' : 'Log Workout Session'}
            </h3>
            <button
              onClick={handleCancel}
              className="text-[#9CA3AF] hover:text-[#F9FAFB] transition-colors"
            >
              <MdClose size={20} />
            </button>
          </div>
          <form onSubmit={handleSubmit} className="space-y-6">
          <Input
            label="Workout Name (Optional)"
            value={formData.split_name}
            onChange={(e) => setFormData({ ...formData, split_name: e.target.value })}
            placeholder="e.g., Push Day, Leg Day, Full Body"
          />

          <Input
            label="Date"
            type="date"
            value={formData.date}
            onChange={(e) => setFormData({ ...formData, date: e.target.value })}
            required
          />

          <div className="mb-4">
            <label className="block text-sm font-semibold text-[#F9FAFB] mb-2">
              Split (Optional)
            </label>
            <select
              value={formData.split_id}
              onChange={(e) => setFormData({ ...formData, split_id: e.target.value })}
              className="w-full px-4 py-3 rounded-lg bg-[#1A1F3A] border-2 border-[#374151] text-[#F9FAFB] focus:outline-none focus:ring-2 focus:ring-[#6366F1]"
            >
              <option value="">No Split</option>
              {splits.map(split => (
                <option key={split.id} value={split.id}>{split.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold text-[#F9FAFB] mb-2">
              Exercises
            </label>
            <div className="flex gap-2 mb-4">
              <select
                value={currentExercise.exercise_id}
                onChange={(e) => handleExerciseChange(e.target.value)}
                className="flex-1 px-4 py-3 rounded-lg bg-[#1A1F3A] border-2 border-[#374151] text-[#F9FAFB] focus:outline-none focus:ring-2 focus:ring-[#6366F1]"
              >
                <option value="">Select exercise</option>
                {exercises.map(ex => (
                  <option key={ex.id} value={ex.id}>{ex.name}</option>
                ))}
              </select>
              <Button
                type="button"
                onClick={() => {
                  if (currentExercise.exercise_id && currentExercise.sets.length > 0) {
                    addExerciseToSession();
                  }
                }}
                variant="primary"
                disabled={!currentExercise.exercise_id || currentExercise.sets.length === 0}
                icon={<MdAdd />}
              >
                Add
              </Button>
            </div>

            {currentExercise.exercise_id && (
              <Card className="mb-4 p-4">
                <div className="flex items-start justify-between mb-4">
                  <h4 className="text-base font-semibold text-[#F9FAFB]">{currentExercise.exercise_name}</h4>
                </div>
                
                <div className="mb-3">
                  <div className="grid grid-cols-12 gap-2 mb-2 text-xs font-semibold text-[#9CA3AF] border-b border-[#374151] pb-2">
                    <div className="col-span-2">Set</div>
                    <div className="col-span-5">Reps</div>
                    <div className="col-span-5">Weight (lbs)</div>
                  </div>
                  
                  {currentExercise.sets.map((set, idx) => (
                    <div key={idx} className="grid grid-cols-12 gap-2 mb-2 items-center">
                      <div className="col-span-2 text-sm text-[#F9FAFB]">{set.set_number}</div>
                      <div className="col-span-5">
                        <input
                          type="number"
                          value={set.reps}
                          onChange={(e) => {
                            const newSets = [...currentExercise.sets];
                            newSets[idx] = { ...newSets[idx], reps: parseInt(e.target.value) || 0 };
                            setCurrentExercise({ ...currentExercise, sets: newSets });
                          }}
                          className="w-full px-2 py-1 rounded bg-[#1A1F3A] border border-[#374151] text-[#F9FAFB] text-sm focus:outline-none focus:ring-1 focus:ring-[#6366F1]"
                        />
                      </div>
                      <div className="col-span-4">
                        <input
                          type="number"
                          value={set.weight || ''}
                          onChange={(e) => {
                            const newSets = [...currentExercise.sets];
                            newSets[idx] = { ...newSets[idx], weight: e.target.value ? parseFloat(e.target.value) : undefined };
                            setCurrentExercise({ ...currentExercise, sets: newSets });
                          }}
                          className="w-full px-2 py-1 rounded bg-[#1A1F3A] border border-[#374151] text-[#F9FAFB] text-sm focus:outline-none focus:ring-1 focus:ring-[#6366F1]"
                        />
                      </div>
                      <div className="col-span-1">
                        <button
                          type="button"
                          onClick={() => {
                            const newSets = currentExercise.sets.filter((_, i) => i !== idx);
                            setCurrentExercise({
                              ...currentExercise,
                              sets: newSets.map((s, i) => ({ ...s, set_number: i + 1 }))
                            });
                          }}
                          className="text-[#EF4444] hover:text-[#DC2626]"
                        >
                          <MdClose size={16} />
                        </button>
                      </div>
                    </div>
                  ))}
                  
                  <div className="flex gap-2 mt-3">
                    <input
                      type="number"
                      value={currentSet.reps}
                      onChange={(e) => setCurrentSet({ ...currentSet, reps: e.target.value })}
                      placeholder="Reps"
                      className="flex-1 px-3 py-2 rounded-lg bg-[#1A1F3A] border-2 border-[#374151] text-[#F9FAFB] placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#6366F1] text-sm"
                    />
                    <input
                      type="number"
                      value={currentSet.weight}
                      onChange={(e) => setCurrentSet({ ...currentSet, weight: e.target.value })}
                      placeholder="Weight"
                      className="flex-1 px-3 py-2 rounded-lg bg-[#1A1F3A] border-2 border-[#374151] text-[#F9FAFB] placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#6366F1] text-sm"
                    />
                    <Button
                      type="button"
                      onClick={addSet}
                      variant="secondary"
                      className="whitespace-nowrap"
                    >
                      + Add Set
                    </Button>
                  </div>
                </div>
              </Card>
            )}
          </div>

          {formData.exercises.length > 0 && (
            <div className="mb-6 space-y-4">
              {formData.exercises.map((ex, idx) => (
                <Card key={idx} className="p-4">
                  <div className="flex items-start justify-between mb-4">
                    <h4 className="text-base font-semibold text-[#F9FAFB]">{ex.exercise_name}</h4>
                    <button
                      type="button"
                      onClick={() => setFormData({
                        ...formData,
                        exercises: formData.exercises.filter((_, i) => i !== idx)
                      })}
                      className="text-[#EF4444] hover:text-[#DC2626]"
                    >
                      <MdDelete size={20} />
                    </button>
                  </div>
                  
                  <div className="grid grid-cols-12 gap-2 text-xs font-semibold text-[#9CA3AF] border-b border-[#374151] pb-2 mb-2">
                    <div className="col-span-2">Set</div>
                    <div className="col-span-5">Reps</div>
                    <div className="col-span-5">Weight (lbs)</div>
                  </div>
                  
                  {Array.isArray(ex.sets) && ex.sets.map((set: WorkoutSet, setIdx: number) => (
                    <div key={setIdx} className="grid grid-cols-12 gap-2 mb-2 text-sm text-[#F9FAFB]">
                      <div className="col-span-2">{set.set_number}</div>
                      <div className="col-span-5">{set.reps}</div>
                      <div className="col-span-5">{set.weight || '-'}</div>
                    </div>
                  ))}
                </Card>
              ))}
            </div>
          )}

          <Input
            label="Notes (Optional)"
            value={formData.notes}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            placeholder="How did the workout feel?"
          />

            <div className="flex gap-4 pt-4">
              <Button
                type="submit"
                variant="primary"
                disabled={formData.exercises.length === 0}
              >
                {editingSessionId ? 'Update Workout' : 'Save Workout'}
              </Button>
              <Button type="button" variant="secondary" onClick={handleCancel}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {sessions.map((session) => (
          <Card key={session.id}>
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-lg bg-[#6366F1]/20 flex items-center justify-center flex-shrink-0">
                <MdFitnessCenter className="text-[#6366F1] text-2xl" />
              </div>
              <div className="flex-1">
                <div className="flex items-start justify-between mb-2">
                  <h3 className="text-lg font-semibold text-[#F9FAFB]">
                    {session.split_name || 'Workout Session'}
                  </h3>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleEdit(session)}
                      className="text-[#6366F1] hover:text-[#8B5CF6] transition-colors"
                      title="Edit"
                    >
                      <MdEdit size={20} />
                    </button>
                    <button
                      onClick={() => handleDelete(session.id!)}
                      className="text-[#EF4444] hover:text-[#DC2626] transition-colors"
                      title="Delete"
                    >
                      <MdDelete size={20} />
                    </button>
                  </div>
                </div>
                <p className="text-sm text-[#9CA3AF] mb-2">{session.date}</p>
                <p className="text-sm text-[#9CA3AF]">
                  {session.exercises?.length || 0} exercises
                </p>
                {session.notes && (
                  <p className="text-sm text-[#F9FAFB] mt-2 italic">{session.notes}</p>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
