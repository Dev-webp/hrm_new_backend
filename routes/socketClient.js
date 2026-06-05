// socketClient.js

const socket = io(window.location.origin, {
  auth: {
    token: localStorage.getItem("token")
  }
});

window.hrmsSocket = socket;

window.notificationState = {
  unread: 0
};

// GLOBAL EVENT LISTENER
socket.on("new_notification", (notification) => {

  console.log("Notification received:", notification);

  // increase unread count
  window.notificationState.unread++;

  // update navbar bell
  updateNotificationBadge();

  // update leave badge
  updateLeaveBadge(notification);

  // optional toast popup
  showToast(notification);

});

// UPDATE NAVBAR BADGE
function updateNotificationBadge() {

  const badges = document.querySelectorAll(".notification-count");

  badges.forEach(el => {
    el.style.display =
      window.notificationState.unread > 0
        ? "flex"
        : "none";

    el.textContent = window.notificationState.unread;
  });
}

// UPDATE LEAVE PAGE BADGE
function updateLeaveBadge(notification) {

  if (
    notification.type === "LEAVE_APPLIED" ||
    notification.type === "LEAVE_STATUS"
  ) {

    const leaveBadges = document.querySelectorAll(".leave-count");

    leaveBadges.forEach(el => {

      const current = Number(el.textContent || 0);

      el.style.display = "flex";
      el.textContent = current + 1;

    });
  }
}

// TOAST
function showToast(notification) {

  const toast = document.createElement("div");

  toast.className = "live-toast";

  toast.innerHTML = `
    <strong>${notification.title}</strong>
    <div>${notification.message}</div>
  `;

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 4000);
}