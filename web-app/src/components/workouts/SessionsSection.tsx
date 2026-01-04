'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import apiClient from '@/lib/api-client';
import { WorkoutSession, Exercise, Split, SessionExercise, WorkoutSet } from '@/types';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import { MdAdd, MdDelete, MdFitnessCenter, MdClose, MdEdit, MdKeyboardArrowDown, MdSearch, MdArrowBack } from 'react-icons/md';
import defaultExercises, { categories, categoryToMuscleGroup } from '@/data/defaultExercises';

interface AddSetToExerciseProps {
  exerciseIndex: number;
  onAddSet: (reps: string, weight: string) => void;
}

function AddSetToExercise({ onAddSet }: AddSetToExerciseProps) {
  const [reps, setReps] = useState('');
  const [weight, setWeight] = useState('');

  const handleAdd = () => {
    if (reps) {
      onAddSet(reps, weight);
      setReps('');
      setWeight('');
    }
  };

  return (
    <div className="flex flex-col sm:flex-row gap-2 mt-3">
      <input
        type="number"
        value={reps}
        onChange={(e) => setReps(e.target.value)}
        placeholder="Reps"
        className="flex-1 px-3 sm:px-3 py-2.5 sm:py-2 rounded-lg bg-[#1A1F3A] border-2 border-[#374151] text-[#F9FAFB] placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#6366F1] text-base sm:text-sm"
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            handleAdd();
          }
        }}
      />
      <input
        type="number"
        value={weight}
        onChange={(e) => setWeight(e.target.value)}
        placeholder="Weight (lbs)"
        className="flex-1 px-3 sm:px-3 py-2.5 sm:py-2 rounded-lg bg-[#1A1F3A] border-2 border-[#374151] text-[#F9FAFB] placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#6366F1] text-base sm:text-sm"
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            handleAdd();
          }
        }}
      />
      <Button
        type="button"
        onClick={handleAdd}
        variant="secondary"
        className="whitespace-nowrap w-full sm:w-auto"
      >
        + Add Set
      </Button>
    </div>
  );
}

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
  const [showSplitDropdown, setShowSplitDropdown] = useState(false);
  const splitDropdownRef = useRef<HTMLDivElement>(null);
  const [showExerciseDropdown, setShowExerciseDropdown] = useState(false);
  const [exerciseSearchQuery, setExerciseSearchQuery] = useState('');
  const exerciseDropdownRef = useRef<HTMLDivElement>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedEquipment, setSelectedEquipment] = useState<string | null>(null);

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

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        splitDropdownRef.current &&
        !splitDropdownRef.current.contains(event.target as Node)
      ) {
        setShowSplitDropdown(false);
      }
      if (
        exerciseDropdownRef.current &&
        !exerciseDropdownRef.current.contains(event.target as Node)
      ) {
        setShowExerciseDropdown(false);
      }
    };

    if (showSplitDropdown || showExerciseDropdown) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showSplitDropdown, showExerciseDropdown]);

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

  const allExercises = useMemo(() => {
    const defaultExercisesList = defaultExercises.map(ex => ({
      id: ex.id,
      name: ex.name,
      category: ex.category,
      equipment: ex.equipment,
      is_default: true
    }));
    
    const customExercisesList = exercises
      .filter(ex => ex.id)
      .map(ex => {
        let category = null;
        if (ex.muscle_group) {
          const muscleGroup = ex.muscle_group.toLowerCase();
          for (const [cat, muscle] of Object.entries(categoryToMuscleGroup)) {
            if (muscleGroup.includes(muscle.toLowerCase())) {
              category = cat;
              break;
            }
          }
        }
        return {
          id: ex.id!,
          name: ex.name,
          category: category,
          equipment: null,
          is_default: false
        };
      });
    
    return [...defaultExercisesList, ...customExercisesList];
  }, [exercises]);

  const getEquipmentTypes = (category: string): string[] => {
    const equipmentSet = new Set<string>();
    defaultExercises
      .filter(ex => ex.category === category)
      .forEach(ex => equipmentSet.add(ex.equipment));
    return Array.from(equipmentSet).sort();
  };

  const getExercisesForCategoryAndEquipment = (category: string, equipment: string) => {
    return allExercises.filter(ex => 
      ex.category === category && ex.equipment === equipment
    );
  };

  const handleExerciseChange = (exerciseId: string, exerciseName: string) => {
    setCurrentExercise({
      ...currentExercise,
      exercise_id: exerciseId,
      exercise_name: exerciseName
    });
    setShowExerciseDropdown(false);
    setExerciseSearchQuery('');
    setSelectedCategory(null);
    setSelectedEquipment(null);
  };

  const filteredExercises = exerciseSearchQuery.trim() 
    ? allExercises.filter(ex =>
        ex.name.toLowerCase().includes(exerciseSearchQuery.toLowerCase())
      )
    : [];

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
    setShowExerciseDropdown(false);
    setExerciseSearchQuery('');
    setSelectedCategory(null);
    setSelectedEquipment(null);
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
        <Card className="mb-6 sm:mb-8 p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-0 mb-4 sm:mb-6">
            <h3 className="text-base sm:text-lg font-semibold text-[#F9FAFB]">
              {editingSessionId ? 'Edit Workout Session' : 'Log Workout Session'}
            </h3>
            <button
              onClick={handleCancel}
              className="text-[#9CA3AF] hover:text-[#F9FAFB] transition-colors self-start sm:self-auto"
            >
              <MdClose size={18} className="sm:w-5 sm:h-5" />
            </button>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-6">
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
            <label className="block text-xs sm:text-sm font-semibold text-[#F9FAFB] mb-1.5 sm:mb-2">
              Split (Optional)
            </label>
            <div className="relative z-30" ref={splitDropdownRef}>
              <button
                type="button"
                onClick={() => setShowSplitDropdown(!showSplitDropdown)}
                className="w-full px-3 sm:px-4 py-3 text-base rounded-lg bg-[#1A1F3A] border-2 border-[#374151] text-left text-[#F9FAFB] focus:outline-none focus:ring-2 focus:ring-[#6366F1] cursor-pointer transition-all flex items-center justify-between"
              >
                <span>
                  {formData.split_id 
                    ? splits.find(s => s.id === formData.split_id)?.name || 'No Split'
                    : 'No Split'}
                </span>
                <MdKeyboardArrowDown
                  className={`text-gray-400 text-lg sm:text-xl flex-shrink-0 transition-transform ${
                    showSplitDropdown ? "rotate-180" : ""
                  }`}
                />
              </button>
              {showSplitDropdown && (
                <div className="absolute z-[100] w-full mt-1 bg-[#1A1F3A] border border-[#374151] rounded-lg shadow-lg overflow-hidden">
                  <button
                    type="button"
                    onClick={() => {
                      setFormData({ ...formData, split_id: '' });
                      setShowSplitDropdown(false);
                    }}
                    className={`w-full px-4 py-3 sm:py-4 text-base sm:text-lg text-left text-white hover:bg-[#374151] transition-colors ${
                      !formData.split_id ? "bg-[#6366F1]/20" : ""
                    }`}
                  >
                    No Split
                  </button>
                  {splits.map(split => (
                    <button
                      key={split.id}
                      type="button"
                      onClick={() => {
                        setFormData({ ...formData, split_id: split.id || '' });
                        setShowSplitDropdown(false);
                      }}
                      className={`w-full px-4 py-3 sm:py-4 text-base sm:text-lg text-left text-white hover:bg-[#374151] transition-colors ${
                        formData.split_id === split.id ? "bg-[#6366F1]/20" : ""
                      }`}
                    >
                      {split.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="block text-xs sm:text-sm font-semibold text-[#F9FAFB] mb-1.5 sm:mb-2">
              Exercises
            </label>
            <div className="flex flex-col sm:flex-row gap-2 mb-4">
              <div className="relative z-30 flex-1" ref={exerciseDropdownRef}>
                <button
                  type="button"
                  onClick={() => setShowExerciseDropdown(!showExerciseDropdown)}
                  className="w-full px-3 sm:px-4 py-3 text-base rounded-lg bg-[#1A1F3A] border-2 border-[#374151] text-left text-[#F9FAFB] focus:outline-none focus:ring-2 focus:ring-[#6366F1] cursor-pointer transition-all flex items-center justify-between"
                >
                  <span>
                    {currentExercise.exercise_name || 'Select exercise'}
                  </span>
                  <MdKeyboardArrowDown
                    className={`text-gray-400 text-lg sm:text-xl flex-shrink-0 transition-transform ${
                      showExerciseDropdown ? "rotate-180" : ""
                    }`}
                  />
                </button>
                {showExerciseDropdown && (
                  <div className="absolute z-[100] w-full mt-1 bg-[#1A1F3A] border border-[#374151] rounded-lg shadow-lg overflow-hidden">
                    <div className="p-2 border-b border-[#374151]">
                      <div className="relative">
                        <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                          <MdSearch size={16} />
                        </div>
                        <input
                          type="text"
                          value={exerciseSearchQuery}
                          onChange={(e) => {
                            setExerciseSearchQuery(e.target.value);
                            if (e.target.value.trim()) {
                              setSelectedCategory(null);
                              setSelectedEquipment(null);
                            }
                          }}
                          placeholder="Search exercises..."
                          className="w-full pl-8 pr-3 py-2 rounded-lg bg-[#2d3b4e] border border-[#374151] text-[#F9FAFB] placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-[#6366F1] text-sm"
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>
                    </div>
                    <div className="max-h-48 sm:max-h-60 overflow-y-auto">
                      {exerciseSearchQuery.trim() ? (
                        filteredExercises.length > 0 ? (
                          filteredExercises.map(ex => (
                            <button
                              key={ex.id}
                              type="button"
                              onClick={() => handleExerciseChange(ex.id, ex.name)}
                              className={`w-full px-4 py-3 sm:py-4 text-base sm:text-lg text-left text-white hover:bg-[#374151] transition-colors ${
                                currentExercise.exercise_id === ex.id ? "bg-[#6366F1]/20" : ""
                              }`}
                            >
                              {ex.name}
                            </button>
                          ))
                        ) : (
                          <div className="px-4 py-3 text-sm text-gray-400 text-center">
                            No exercises found
                          </div>
                        )
                      ) : selectedCategory && selectedEquipment ? (
                        <>
                          <button
                            type="button"
                            onClick={() => setSelectedEquipment(null)}
                            className="w-full px-4 py-2 text-sm text-[#9CA3AF] hover:bg-[#374151] transition-colors flex items-center gap-2 border-b border-[#374151]"
                          >
                            <MdArrowBack size={16} />
                            <span>Back to {selectedCategory}</span>
                          </button>
                          {getExercisesForCategoryAndEquipment(selectedCategory, selectedEquipment).length > 0 ? (
                            getExercisesForCategoryAndEquipment(selectedCategory, selectedEquipment).map(ex => (
                              <button
                                key={ex.id}
                                type="button"
                                onClick={() => handleExerciseChange(ex.id, ex.name)}
                                className={`w-full px-4 py-3 sm:py-4 text-base sm:text-lg text-left text-white hover:bg-[#374151] transition-colors ${
                                  currentExercise.exercise_id === ex.id ? "bg-[#6366F1]/20" : ""
                                }`}
                              >
                                {ex.name}
                              </button>
                            ))
                          ) : (
                            <div className="px-4 py-3 text-sm text-gray-400 text-center">
                              No exercises found
                            </div>
                          )}
                        </>
                      ) : selectedCategory ? (
                        <>
                          <button
                            type="button"
                            onClick={() => setSelectedCategory(null)}
                            className="w-full px-4 py-2 text-sm text-[#9CA3AF] hover:bg-[#374151] transition-colors flex items-center gap-2 border-b border-[#374151]"
                          >
                            <MdArrowBack size={16} />
                            <span>Back to Categories</span>
                          </button>
                          {getEquipmentTypes(selectedCategory).map(equipment => (
                            <button
                              key={equipment}
                              type="button"
                              onClick={() => setSelectedEquipment(equipment)}
                              className="w-full px-4 py-3 sm:py-4 text-base sm:text-lg text-left text-white hover:bg-[#374151] transition-colors"
                            >
                              {equipment}
                            </button>
                          ))}
                        </>
                      ) : (
                        categories.map(category => (
                          <button
                            key={category}
                            type="button"
                            onClick={() => setSelectedCategory(category)}
                            className="w-full px-4 py-3 sm:py-4 text-base sm:text-lg text-left text-white hover:bg-[#374151] transition-colors"
                          >
                            {category}
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
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
                className="w-full sm:w-auto"
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
                  <div className="hidden sm:grid grid-cols-12 gap-2 mb-2 text-xs font-semibold text-[#9CA3AF] border-b border-[#374151] pb-2">
                    <div className="col-span-1">Set</div>
                    <div className="col-span-4">Reps</div>
                    <div className="col-span-5">Weight (lbs)</div>
                    <div className="col-span-2"></div>
                  </div>
                  
                  {currentExercise.sets.map((set, idx) => (
                    <div key={idx} className="flex flex-col sm:grid sm:grid-cols-12 gap-2 mb-3 sm:mb-2 items-start sm:items-center p-2 sm:p-0 rounded-lg sm:rounded-none bg-[#1A1F3A]/50 sm:bg-transparent">
                      <div className="flex items-center justify-between w-full sm:w-auto sm:col-span-1 mb-1 sm:mb-0">
                        <span className="text-xs sm:text-sm font-semibold text-[#9CA3AF] sm:hidden">Set {set.set_number}</span>
                        <span className="hidden sm:inline text-sm text-[#F9FAFB]">{set.set_number}</span>
                        <button
                          type="button"
                          onClick={() => {
                            const newSets = currentExercise.sets.filter((_, i) => i !== idx);
                            setCurrentExercise({
                              ...currentExercise,
                              sets: newSets.map((s, i) => ({ ...s, set_number: i + 1 }))
                            });
                          }}
                          className="sm:hidden text-[#EF4444] hover:text-[#DC2626] p-1"
                        >
                          <MdClose size={18} />
                        </button>
                      </div>
                      <div className="w-full sm:col-span-4">
                        <label className="block text-xs font-semibold text-[#9CA3AF] mb-1 sm:hidden">Reps</label>
                        <input
                          type="number"
                          value={set.reps}
                          onChange={(e) => {
                            const newSets = [...currentExercise.sets];
                            newSets[idx] = { ...newSets[idx], reps: parseInt(e.target.value) || 0 };
                            setCurrentExercise({ ...currentExercise, sets: newSets });
                          }}
                          className="w-full px-3 sm:px-2 py-2.5 sm:py-1 rounded-lg sm:rounded bg-[#2d3b4e] sm:bg-[#1A1F3A] border-2 sm:border border-[#374151] text-[#F9FAFB] text-base sm:text-sm focus:outline-none focus:ring-2 sm:focus:ring-1 focus:ring-[#6366F1]"
                          placeholder="Reps"
                        />
                      </div>
                      <div className="w-full sm:col-span-5">
                        <label className="block text-xs font-semibold text-[#9CA3AF] mb-1 sm:hidden">Weight (lbs)</label>
                        <input
                          type="number"
                          value={set.weight || ''}
                          onChange={(e) => {
                            const newSets = [...currentExercise.sets];
                            newSets[idx] = { ...newSets[idx], weight: e.target.value ? parseFloat(e.target.value) : undefined };
                            setCurrentExercise({ ...currentExercise, sets: newSets });
                          }}
                          className="w-full px-3 sm:px-2 py-2.5 sm:py-1 rounded-lg sm:rounded bg-[#2d3b4e] sm:bg-[#1A1F3A] border-2 sm:border border-[#374151] text-[#F9FAFB] text-base sm:text-sm focus:outline-none focus:ring-2 sm:focus:ring-1 focus:ring-[#6366F1]"
                          placeholder="Weight (lbs)"
                        />
                      </div>
                      <div className="hidden sm:block sm:col-span-2">
                        <button
                          type="button"
                          onClick={() => {
                            const newSets = currentExercise.sets.filter((_, i) => i !== idx);
                            setCurrentExercise({
                              ...currentExercise,
                              sets: newSets.map((s, i) => ({ ...s, set_number: i + 1 }))
                            });
                          }}
                          className="text-[#EF4444] hover:text-[#DC2626] ml-auto"
                        >
                          <MdClose size={16} />
                        </button>
                      </div>
                    </div>
                  ))}
                  
                  <div className="flex flex-col sm:flex-row gap-2 mt-3">
                    <input
                      type="number"
                      value={currentSet.reps}
                      onChange={(e) => setCurrentSet({ ...currentSet, reps: e.target.value })}
                      placeholder="Reps"
                      className="flex-1 px-3 sm:px-3 py-2.5 sm:py-2 rounded-lg bg-[#1A1F3A] border-2 border-[#374151] text-[#F9FAFB] placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#6366F1] text-base sm:text-sm"
                    />
                    <input
                      type="number"
                      value={currentSet.weight}
                      onChange={(e) => setCurrentSet({ ...currentSet, weight: e.target.value })}
                      placeholder="Weight (lbs)"
                      className="flex-1 px-3 sm:px-3 py-2.5 sm:py-2 rounded-lg bg-[#1A1F3A] border-2 border-[#374151] text-[#F9FAFB] placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#6366F1] text-base sm:text-sm"
                    />
                    <Button
                      type="button"
                      onClick={addSet}
                      variant="secondary"
                      className="whitespace-nowrap w-full sm:w-auto"
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
              {formData.exercises.map((ex, idx) => {
                const exerciseSets = Array.isArray(ex.sets) ? ex.sets : [];
                return (
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
                    
                    <div className="hidden sm:grid grid-cols-12 gap-2 text-xs font-semibold text-[#9CA3AF] border-b border-[#374151] pb-2 mb-2">
                      <div className="col-span-1">Set</div>
                      <div className="col-span-4">Reps</div>
                      <div className="col-span-5">Weight (lbs)</div>
                      <div className="col-span-2"></div>
                    </div>
                    
                    {exerciseSets.map((set: WorkoutSet, setIdx: number) => (
                      <div key={setIdx} className="flex flex-col sm:grid sm:grid-cols-12 gap-2 mb-3 sm:mb-2 items-start sm:items-center p-2 sm:p-0 rounded-lg sm:rounded-none bg-[#1A1F3A]/50 sm:bg-transparent">
                        <div className="flex items-center justify-between w-full sm:w-auto sm:col-span-1 mb-1 sm:mb-0">
                          <span className="text-xs sm:text-sm font-semibold text-[#9CA3AF] sm:hidden">Set {set.set_number}</span>
                          <span className="hidden sm:inline text-sm text-[#F9FAFB]">{set.set_number}</span>
                          <button
                            type="button"
                            onClick={() => {
                              const newExercises = [...formData.exercises];
                              const newSets = exerciseSets.filter((_, i) => i !== setIdx);
                              newExercises[idx] = { 
                                ...newExercises[idx], 
                                sets: newSets.map((s, i) => ({ ...s, set_number: i + 1 }))
                              };
                              setFormData({ ...formData, exercises: newExercises });
                            }}
                            className="sm:hidden text-[#EF4444] hover:text-[#DC2626] p-1"
                          >
                            <MdClose size={18} />
                          </button>
                        </div>
                        <div className="w-full sm:col-span-4">
                          <label className="block text-xs font-semibold text-[#9CA3AF] mb-1 sm:hidden">Reps</label>
                          <input
                            type="number"
                            value={set.reps}
                            onChange={(e) => {
                              const newExercises = [...formData.exercises];
                              const newSets = [...exerciseSets];
                              newSets[setIdx] = { ...newSets[setIdx], reps: parseInt(e.target.value) || 0 };
                              newExercises[idx] = { ...newExercises[idx], sets: newSets };
                              setFormData({ ...formData, exercises: newExercises });
                            }}
                            className="w-full px-3 sm:px-2 py-2.5 sm:py-1 rounded-lg sm:rounded bg-[#2d3b4e] sm:bg-[#1A1F3A] border-2 sm:border border-[#374151] text-[#F9FAFB] text-base sm:text-sm focus:outline-none focus:ring-2 sm:focus:ring-1 focus:ring-[#6366F1]"
                            placeholder="Reps"
                          />
                        </div>
                        <div className="w-full sm:col-span-5">
                          <label className="block text-xs font-semibold text-[#9CA3AF] mb-1 sm:hidden">Weight (lbs)</label>
                          <input
                            type="number"
                            value={set.weight || ''}
                            onChange={(e) => {
                              const newExercises = [...formData.exercises];
                              const newSets = [...exerciseSets];
                              newSets[setIdx] = { ...newSets[setIdx], weight: e.target.value ? parseFloat(e.target.value) : undefined };
                              newExercises[idx] = { ...newExercises[idx], sets: newSets };
                              setFormData({ ...formData, exercises: newExercises });
                            }}
                            className="w-full px-3 sm:px-2 py-2.5 sm:py-1 rounded-lg sm:rounded bg-[#2d3b4e] sm:bg-[#1A1F3A] border-2 sm:border border-[#374151] text-[#F9FAFB] text-base sm:text-sm focus:outline-none focus:ring-2 sm:focus:ring-1 focus:ring-[#6366F1]"
                            placeholder="Weight (lbs)"
                          />
                        </div>
                        <div className="hidden sm:block sm:col-span-2">
                          <button
                            type="button"
                            onClick={() => {
                              const newExercises = [...formData.exercises];
                              const newSets = exerciseSets.filter((_, i) => i !== setIdx);
                              newExercises[idx] = { 
                                ...newExercises[idx], 
                                sets: newSets.map((s, i) => ({ ...s, set_number: i + 1 }))
                              };
                              setFormData({ ...formData, exercises: newExercises });
                            }}
                            className="text-[#EF4444] hover:text-[#DC2626] ml-auto"
                          >
                            <MdClose size={16} />
                          </button>
                        </div>
                      </div>
                    ))}
                    
                    <AddSetToExercise
                      exerciseIndex={idx}
                      onAddSet={(reps, weight) => {
                        const newExercises = [...formData.exercises];
                        const newSets = [...exerciseSets];
                        newSets.push({
                          set_number: exerciseSets.length + 1,
                          reps: parseInt(reps) || 0,
                          weight: weight ? parseFloat(weight) : undefined
                        });
                        newExercises[idx] = { ...newExercises[idx], sets: newSets };
                        setFormData({ ...formData, exercises: newExercises });
                      }}
                    />
                  </Card>
                );
              })}
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
