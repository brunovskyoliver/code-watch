import { AnimatePresence, motion } from "motion/react";
import type { GitWorkflowEvent } from "@shared/types";

export interface WorkflowNotification extends GitWorkflowEvent {
  dismissed?: boolean;
}

export function NotificationList({
  notifications,
  onDismiss,
  onOpen
}: {
  notifications: WorkflowNotification[];
  onDismiss: (id: string) => void;
  onOpen: (url: string) => void;
}) {
  return (
    <div className="notification-list" aria-live="polite" aria-atomic="false">
      <AnimatePresence initial={false}>
        {notifications.map((notification, index) => {
          const isComplete = notification.stage === "completed" && Boolean(notification.prUrl);
          const isPending = notification.stage === "committing" || notification.stage === "pushing" || notification.stage === "creating-pr";

          return (
            <motion.article
              key={notification.id}
              layout
              initial={{ opacity: 0, x: 40, y: -16, scale: 0.96 }}
              animate={{
                opacity: 1,
                x: 0,
                y: index * 10,
                scale: 1 - index * 0.02
              }}
              exit={{ opacity: 0, x: 28, y: -20, scale: 0.95 }}
              transition={{ type: "spring", stiffness: 360, damping: 28 }}
              className={`notification-card notification-card-${notification.stage}`}
            >
              <div className="notification-card-main">
                <div className="notification-card-copy">
                  <strong>{notification.title}</strong>
                  <p>{notification.message}</p>
                </div>
                <button type="button" className="notification-dismiss" onClick={() => onDismiss(notification.id)} aria-label="Dismiss notification">
                  ×
                </button>
              </div>

              {isPending ? (
                <motion.div
                  className="notification-progress"
                  initial={{ scaleX: 0.2, opacity: 0.8 }}
                  animate={{ scaleX: 1, opacity: 1 }}
                  transition={{ repeat: Number.POSITIVE_INFINITY, duration: 1.1, ease: "easeInOut", repeatType: "reverse" }}
                />
              ) : null}

              {isComplete ? (
                <div className="notification-card-actions">
                  <button type="button" className="notification-open-button" onClick={() => onOpen(notification.prUrl!)}>
                    Open
                  </button>
                </div>
              ) : null}
            </motion.article>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
