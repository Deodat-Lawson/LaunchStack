"use client";

import React, { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "~/app/employer/documents/components/ui/button";
import { Input } from "~/app/employer/documents/components/ui/input";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "~/app/employer/documents/components/ui/alert-dialog";

interface Category {
    id: string;
    name: string;
}

interface CategoryManagementProps {
    categories: Category[];
    onAddCategory: (newCategory: string) => Promise<void>;
    onRemoveCategory: (id: string, categoryName: string) => Promise<void>;
}

const CategoryManagement: React.FC<CategoryManagementProps> = ({
    categories,
    onAddCategory,
    onRemoveCategory,
}) => {
    const [newCategory, setNewCategory] = useState("");
    const [categoryToDelete, setCategoryToDelete] = useState<Category | null>(null);

    const handleAddCategory = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await onAddCategory(newCategory);
            setNewCategory("");
        } catch (error) {
            console.error("Error adding category:", error);
        }
    };

    const confirmDeleteCategory = async () => {
        if (!categoryToDelete) return;
        try {
            await onRemoveCategory(categoryToDelete.id, categoryToDelete.name);
            setCategoryToDelete(null);
        } catch (error) {
            console.error("Error removing category:", error);
        }
    };

    return (
        <div className="mt-6 bg-white dark:bg-slate-900/50 border border-gray-200 dark:border-purple-500/20 rounded-lg p-6 shadow-sm">
            <h3 className="text-base font-medium text-gray-900 dark:text-gray-100 mb-3">
                Manage Categories
            </h3>

            <form onSubmit={handleAddCategory} className="flex items-center gap-3 mb-6">
                <Input
                    type="text"
                    placeholder="New category name"
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    className="flex-1"
                />
                <Button type="submit" disabled={!newCategory.trim()}>
                    Add Category
                </Button>
            </form>

            {categories.length === 0 ? (
                <div className="py-8 px-6 rounded-xl bg-gray-50 dark:bg-slate-800/40 border border-dashed border-gray-200 dark:border-purple-500/20 text-center">
                    <p className="text-gray-700 dark:text-gray-200 font-medium mb-2">
                        No categories yet. Create one to organize your documents.
                    </p>
                    <p className="text-gray-500 dark:text-gray-400 text-sm">
                        Add a category above, or create one when uploading a document.
                    </p>
                </div>
            ) : (
                <div className="space-y-2">
                    {categories.map((cat) => (
                        <div
                            key={cat.id}
                            className="flex items-center justify-between py-2 px-3 bg-gray-50 dark:bg-slate-800/60 rounded-md hover:bg-gray-100 dark:hover:bg-slate-700/60 transition-colors"
                        >
                            <span className="text-sm text-gray-900 dark:text-gray-200">
                                {cat.name}
                            </span>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setCategoryToDelete(cat)}
                                className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                aria-label={`Delete ${cat.name} category`}
                            >
                                <Trash2 className="h-4 w-4" />
                            </Button>
                        </div>
                    ))}
                </div>
            )}

            <AlertDialog
                open={!!categoryToDelete}
                onOpenChange={(open) => !open && setCategoryToDelete(null)}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete Category</AlertDialogTitle>
                        <AlertDialogDescription>
                            Are you sure you want to delete &quot;{categoryToDelete?.name}&quot;?
                            This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => void confirmDeleteCategory()}
                            className="bg-red-600 hover:bg-red-700"
                        >
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default CategoryManagement;
