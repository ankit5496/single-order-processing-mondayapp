import React, { useState } from "react"
import { motion } from "framer-motion"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./dialog"
import { Button } from "./button"
import { AlertTriangle, Loader2 } from "lucide-react"

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: string
  description?: string
  confirmText?: string
  cancelText?: string
  onConfirm: () => Promise<void> | void
  confirmColor?: string
  loading?: boolean
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title = "Are you sure?",
  description = "This action cannot be undone.",
  confirmText = "Confirm",
  cancelText = "Cancel",
  onConfirm,
  confirmColor = "green",
  loading = false,
}: ConfirmDialogProps) {
  const [internalLoading, setInternalLoading] = useState(false)

  const handleConfirmClick = async () => {
    setInternalLoading(true)
    await onConfirm()
    setInternalLoading(false)
  }

  const colorClasses =
    confirmColor === "red"
      ? "bg-red-600 hover:bg-red-700"
      : "bg-green-600 hover:bg-green-700"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-2xl shadow-xl border border-gray-200">
        <DialogHeader className="flex flex-col items-center text-center space-y-2">
          <motion.div
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.3 }}
          >
            <AlertTriangle className="h-10 w-10 text-yellow-500" />
          </motion.div>
          <DialogTitle className="text-lg font-semibold text-gray-800">
            {title}
          </DialogTitle>
          <DialogDescription className="text-gray-600">
            {description}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex justify-center gap-4 pt-3">
          <Button
            variant="outline"
            className="rounded-xl px-6"
            onClick={() => onOpenChange(false)}
            disabled={internalLoading || loading}
          >
            {cancelText}
          </Button>
          <Button
            className={`${colorClasses} text-white rounded-xl px-6`}
            onClick={handleConfirmClick}
            disabled={internalLoading || loading}
          >
            {(internalLoading || loading) && (
              <Loader2 className="animate-spin h-4 w-4 mr-2" />
            )}
            {confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
