'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import apiClient from '@/lib/api-client';
import { MacroEntry, FoodItem } from '@/types';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import { MdAdd, MdRestaurant, MdDelete, MdClose, MdEdit } from 'react-icons/md';

interface MacrosSectionProps {
  editEntryId?: string | null;
}

export default function MacrosSection({ editEntryId: propEditEntryId }: MacrosSectionProps = {}) {
  const [entries, setEntries] = useState<MacroEntry[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [useIndividualFoods, setUseIndividualFoods] = useState(true);
  const [formData, setFormData] = useState<MacroEntry>({
    date: new Date().toISOString().split('T')[0],
    food_items: [],
    total_calories: undefined,
    total_protein: undefined,
    total_carbs: undefined,
    total_fats: undefined,
  });
  const [currentFood, setCurrentFood] = useState<FoodItem>({
    name: '',
    calories: 0,
    protein: 0,
    carbs: 0,
    fats: 0,
  });
  const [editingFoodIndex, setEditingFoodIndex] = useState<number | null>(null);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);

  useEffect(() => {
    fetchEntries();
  }, []);

  useEffect(() => {
    if (propEditEntryId && entries.length > 0) {
      const entryToEdit = entries.find((e) => e.id === propEditEntryId);
      if (entryToEdit) {
        handleEditEntry(entryToEdit);
      }
    }
  }, [propEditEntryId, entries]);

  const fetchEntries = async () => {
    try {
      const res = await apiClient.get('/api/macros');
      setEntries(res.data);
    } catch (error) {
      console.error('Error fetching macro entries:', error);
    }
  };

  const addFoodItem = () => {
    if (currentFood.name && currentFood.calories > 0) {
      if (editingFoodIndex !== null) {
        const updatedFoodItems = [...(formData.food_items || [])];
        updatedFoodItems[editingFoodIndex] = currentFood;
        setFormData({
          ...formData,
          food_items: updatedFoodItems,
        });
        setEditingFoodIndex(null);
      } else {
        setFormData({
          ...formData,
          food_items: [...(formData.food_items || []), currentFood],
        });
      }
      setCurrentFood({ name: '', calories: 0, protein: 0, carbs: 0, fats: 0 });
    }
  };

  const editFoodItem = (index: number) => {
    const food = formData.food_items?.[index];
    if (food) {
      setCurrentFood(food);
      setEditingFoodIndex(index);
    }
  };

  const cancelEdit = () => {
    setCurrentFood({ name: '', calories: 0, protein: 0, carbs: 0, fats: 0 });
    setEditingFoodIndex(null);
  };

  const removeFoodItem = (index: number) => {
    setFormData({
      ...formData,
      food_items: formData.food_items?.filter((_, i) => i !== index),
    });
  };

  const calculateTotals = (foods: FoodItem[]) => {
    return foods.reduce(
      (acc, food) => ({
        calories: acc.calories + food.calories,
        protein: acc.protein + food.protein,
        carbs: acc.carbs + (food.carbs || 0),
        fats: acc.fats + (food.fats || 0),
      }),
      { calories: 0, protein: 0, carbs: 0, fats: 0 }
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const dataToSend = useIndividualFoods
        ? { ...formData, food_items: formData.food_items }
        : {
            ...formData,
            food_items: [],
          };

      if (editingEntryId) {
        await apiClient.put(`/api/macros/${editingEntryId}`, dataToSend);
      } else {
        await apiClient.post('/api/macros', dataToSend);
      }

      setFormData({
        date: new Date().toISOString().split('T')[0],
        food_items: [],
        total_calories: undefined,
        total_protein: undefined,
        total_carbs: undefined,
        total_fats: undefined,
      });
      setCurrentFood({ name: '', calories: 0, protein: 0, carbs: 0, fats: 0 });
      setEditingFoodIndex(null);
      setEditingEntryId(null);
      setShowForm(false);
      fetchEntries();
    } catch (error) {
      console.error('Error saving macro entry:', error);
    }
  };

  const handleCancel = () => {
    setFormData({
      date: new Date().toISOString().split('T')[0],
      food_items: [],
      total_calories: undefined,
      total_protein: undefined,
      total_carbs: undefined,
      total_fats: undefined,
    });
    setCurrentFood({ name: '', calories: 0, protein: 0, carbs: 0, fats: 0 });
    setEditingFoodIndex(null);
    setEditingEntryId(null);
    setShowForm(false);
  };

  const handleEditEntry = (entry: MacroEntry) => {
    setFormData({
      date: entry.date,
      food_items: entry.food_items || [],
      total_calories: entry.total_calories,
      total_protein: entry.total_protein,
      total_carbs: entry.total_carbs,
      total_fats: entry.total_fats,
    });
    setUseIndividualFoods(!!(entry.food_items && entry.food_items.length > 0));
    setEditingEntryId(entry.id || null);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (confirm('Delete this entry?')) {
      try {
        await apiClient.delete(`/api/macros/${id}`);
        fetchEntries();
      } catch (error) {
        console.error('Error deleting entry:', error);
      }
    }
  };

  return (
    <div>
      <div className="flex justify-end mb-6">
        {!showForm && (
          <Button onClick={() => setShowForm(true)} icon={<MdAdd />}>
            Log Macros
          </Button>
        )}
      </div>

      {showForm && (
        <Card className="mb-8 p-6 lg:p-8">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-semibold text-[#F9FAFB]">
              {editingEntryId ? 'Edit Macros' : 'Log Macros'}
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
              label="Date"
              type="date"
              value={formData.date}
              onChange={(e) =>
                setFormData({ ...formData, date: e.target.value })
              }
              required
            />

            <div className="mb-4">
              <label className="flex items-center gap-2 text-[#F9FAFB]">
                <input
                  type="checkbox"
                  checked={useIndividualFoods}
                  onChange={(e) => setUseIndividualFoods(e.target.checked)}
                  className="w-4 h-4 rounded"
                />
                <span className="text-sm font-semibold">
                  Log Individual Foods
                </span>
              </label>
            </div>

            {useIndividualFoods ? (
              <>
                <div className="mb-6 p-4 lg:p-6 border border-[#374151] rounded-lg">
                  <h3 className="text-lg font-semibold text-[#F9FAFB] mb-4">
                    {editingFoodIndex !== null
                      ? 'Edit Food Item'
                      : 'Add Food Item'}
                  </h3>
                  <div className="space-y-4">
                    <Input
                      label="Food Name"
                      value={currentFood.name}
                      onChange={(e) =>
                        setCurrentFood({ ...currentFood, name: e.target.value })
                      }
                      placeholder="e.g., Chicken Breast"
                    />
                    <div className="grid grid-cols-2 gap-4">
                      <Input
                        label="Calories"
                        type="number"
                        value={currentFood.calories || ''}
                        onChange={(e) =>
                          setCurrentFood({
                            ...currentFood,
                            calories: parseFloat(e.target.value) || 0,
                          })
                        }
                        required
                      />
                      <Input
                        label="Protein (g)"
                        type="number"
                        value={currentFood.protein || ''}
                        onChange={(e) =>
                          setCurrentFood({
                            ...currentFood,
                            protein: parseFloat(e.target.value) || 0,
                          })
                        }
                        required
                      />
                      <Input
                        label="Carbs (g)"
                        type="number"
                        value={currentFood.carbs || ''}
                        onChange={(e) =>
                          setCurrentFood({
                            ...currentFood,
                            carbs: parseFloat(e.target.value) || 0,
                          })
                        }
                      />
                      <Input
                        label="Fats (g)"
                        type="number"
                        value={currentFood.fats || ''}
                        onChange={(e) =>
                          setCurrentFood({
                            ...currentFood,
                            fats: parseFloat(e.target.value) || 0,
                          })
                        }
                      />
                    </div>
                    <div className="flex gap-2 mt-4">
                      <Button
                        type="button"
                        onClick={addFoodItem}
                        variant="secondary"
                        className="flex-1"
                      >
                        {editingFoodIndex !== null ? 'Update Food' : 'Add Food'}
                      </Button>
                      {editingFoodIndex !== null && (
                        <Button
                          type="button"
                          onClick={cancelEdit}
                          variant="secondary"
                          className="flex-1"
                        >
                          Cancel Edit
                        </Button>
                      )}
                    </div>
                  </div>
                </div>

                {formData.food_items && formData.food_items.length > 0 && (
                  <div className="mb-4">
                    <h3 className="text-lg font-semibold text-[#F9FAFB] mb-3">
                      Foods Added
                    </h3>
                    {formData.food_items.map((food, idx) => (
                      <Card key={idx} className="mb-2">
                        <div className="flex justify-between items-start">
                          <div>
                            <p className="font-semibold text-[#F9FAFB]">
                              {food.name}
                            </p>
                            <p className="text-sm text-[#9CA3AF]">
                              {food.calories} cal | {food.protein}g protein
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => editFoodItem(idx)}
                              className="text-[#6366F1] hover:text-[#818CF8] transition-colors"
                              title="Edit food item"
                            >
                              <MdEdit size={20} />
                            </button>
                            <button
                              type="button"
                              onClick={() => removeFoodItem(idx)}
                              className="text-[#EF4444] hover:text-[#DC2626] transition-colors"
                              title="Delete food item"
                            >
                              <MdDelete size={20} />
                            </button>
                          </div>
                        </div>
                      </Card>
                    ))}
                    <Card variant="gradient" className="mt-3">
                      <p className="font-semibold text-[#F9FAFB] mb-2">
                        Totals
                      </p>
                      {(() => {
                        const totals = calculateTotals(formData.food_items);
                        return (
                          <div className="text-sm text-[#F9FAFB]">
                            <p>Calories: {totals.calories}</p>
                            <p>Protein: {totals.protein}g</p>
                            <p>Carbs: {totals.carbs}g</p>
                            <p>Fats: {totals.fats}g</p>
                          </div>
                        );
                      })()}
                    </Card>
                  </div>
                )}
              </>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="Total Calories"
                  type="number"
                  value={formData.total_calories || ''}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      total_calories: parseFloat(e.target.value) || undefined,
                    })
                  }
                  required
                />
                <Input
                  label="Total Protein (g)"
                  type="number"
                  value={formData.total_protein || ''}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      total_protein: parseFloat(e.target.value) || undefined,
                    })
                  }
                  required
                />
                <Input
                  label="Total Carbs (g)"
                  type="number"
                  value={formData.total_carbs || ''}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      total_carbs: parseFloat(e.target.value) || undefined,
                    })
                  }
                />
                <Input
                  label="Total Fats (g)"
                  type="number"
                  value={formData.total_fats || ''}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      total_fats: parseFloat(e.target.value) || undefined,
                    })
                  }
                />
              </div>
            )}

            <div className="flex gap-4 pt-4">
              <Button type="submit" variant="primary">
                {editingEntryId ? 'Update' : 'Save'}
              </Button>
              <Button type="button" variant="secondary" onClick={handleCancel}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      {entries.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-[#9CA3AF] text-sm">No macro entries yet. Start tracking your nutrition!</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {entries.map((entry) => (
            <Card key={entry.id}>
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-lg bg-[#F59E0B]/20 flex items-center justify-center flex-shrink-0">
                  <MdRestaurant className="text-[#F59E0B] text-2xl" />
                </div>
                <div className="flex-1">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h3 className="text-lg font-semibold text-[#F9FAFB]">
                        {entry.date}
                      </h3>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleEditEntry(entry)}
                        className="text-[#6366F1] hover:text-[#818CF8] transition-colors"
                        title="Edit entry"
                      >
                        <MdEdit size={20} />
                      </button>
                      <button
                        onClick={() => handleDelete(entry.id!)}
                        className="text-[#EF4444] hover:text-[#DC2626] transition-colors"
                        title="Delete entry"
                      >
                        <MdDelete size={20} />
                      </button>
                    </div>
                  </div>
                  {entry.food_items && entry.food_items.length > 0 ? (
                    <>
                      {entry.food_items.map((food, idx) => (
                        <p key={idx} className="text-sm text-[#9CA3AF]">
                          {food.name}: {food.calories} cal | {food.protein}g
                          protein
                        </p>
                      ))}
                      <div className="mt-2 pt-2 border-t border-[#374151]">
                        {(() => {
                          const totals = calculateTotals(entry.food_items);
                          return (
                            <p className="text-sm font-semibold text-[#F9FAFB]">
                              Total: {totals.calories} cal | {totals.protein}g
                              protein | {totals.carbs}g carbs | {totals.fats}g
                              fats
                            </p>
                          );
                        })()}
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-[#F9FAFB]">
                      {entry.total_calories} cal | {entry.total_protein}g protein
                      | {entry.total_carbs}g carbs | {entry.total_fats}g fats
                    </p>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

