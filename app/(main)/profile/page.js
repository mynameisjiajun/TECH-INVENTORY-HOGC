"use client";
import { useAuth } from "@/lib/context/AuthContext";
import { useToast } from "@/lib/context/ToastContext";
import { useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import Navbar from "@/components/Navbar";
import AppShellLoading from "@/components/AppShellLoading";
import { MINISTRY_OPTIONS } from "@/lib/utils/ministries";
import {
  RiUserLine,
  RiLockLine,
  RiCheckLine,
  RiMailLine,
  RiNotificationOffLine,
  RiEmotionLine,
  RiCloseLine,
} from "react-icons/ri";

export default function ProfilePage() {
  const { user, loading, checkAuth } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const [profile, setProfile] = useState(null);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [telegramHandle, setTelegramHandle] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [profileMsg, setProfileMsg] = useState("");
  const [passwordMsg, setPasswordMsg] = useState("");
  const [profileErr, setProfileErr] = useState("");
  const [passwordErr, setPasswordErr] = useState("");
  const [ministry, setMinistry] = useState("");
  const [ministryIsOther, setMinistryIsOther] = useState(false);
  const [muteEmails, setMuteEmails] = useState(false);
  const [muteTelegram, setMuteTelegram] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [unlinkLoading, setUnlinkLoading] = useState(false);
  const [linkStatusLoading, setLinkStatusLoading] = useState(false);
  const [profileEmoji, setProfileEmoji] = useState(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [emojiSaving, setEmojiSaving] = useState(false);

  const loadProfile = useCallback(
    async (options = {}) => {
      const { silent = false } = options;
      if (!user) return;

      if (!silent) {
        setProfileErr("");
      }

      const res = await fetch("/api/profile", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to load profile");
      }

      setProfile(data.profile);
      setDisplayName(data.profile.display_name);
      setEmail(data.profile.email || "");
      setTelegramHandle((data.profile.telegram_handle || "").replace(/^@/, ""));
      const m = data.profile.ministry || "";
      setMinistry(m);
      setMinistryIsOther(m !== "" && !MINISTRY_OPTIONS.includes(m));
      setMuteEmails(!!data.profile.mute_emails);
      setMuteTelegram(!!data.profile.mute_telegram);
      setProfileEmoji(data.profile.profile_emoji || null);
      return data.profile;
    },
    [user],
  );

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    loadProfile().catch((err) => {
      setProfileErr(err.message || "Could not load profile");
    });
  }, [loadProfile, user]);

  const handleRefreshTelegramStatus = async () => {
    setLinkStatusLoading(true);
    try {
      const freshProfile = await loadProfile({ silent: true });
      if (freshProfile?.telegram_chat_id) {
        toast.success("Telegram linked successfully.");
      } else {
        toast.error(
          "Telegram is still not linked. Open the bot and press Start first.",
        );
      }
    } catch (err) {
      toast.error(err.message || "Could not refresh Telegram link status");
    } finally {
      setLinkStatusLoading(false);
    }
  };

  const handleUpdateProfile = async (e) => {
    e.preventDefault();
    setProfileMsg("");
    setProfileErr("");

    const cleanHandle = telegramHandle.trim().replace(/^@/, "");
    if (!cleanHandle) {
      setProfileErr("Telegram handle is required");
      toast.error("Telegram handle is required");
      return;
    }

    setProfileLoading(true);
    try {
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_profile",
          display_name: displayName,
          email: email.trim() || null,
          telegram_handle: cleanHandle,
          ministry: ministry.trim() || null,
          mute_emails: muteEmails,
          mute_telegram: muteTelegram,
          profile_emoji: profileEmoji || "",
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setProfileMsg(data.message);
        toast.success(data.message || "Profile updated");
        checkAuth();
      } else {
        const msg = data.error || "Failed to update profile";
        setProfileErr(msg);
        toast.error(msg);
      }
    } catch (err) {
      const msg = "Network error — could not update profile";
      setProfileErr(msg);
      toast.error(msg);
    } finally {
      setProfileLoading(false);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPasswordMsg("");
    setPasswordErr("");
    if (newPassword !== confirmPassword) {
      setPasswordErr("Passwords do not match");
      return;
    }
    setPasswordLoading(true);
    try {
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "change_password",
          current_password: currentPassword,
          new_password: newPassword,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setPasswordMsg(data.message);
        toast.success(data.message || "Password changed successfully");
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      } else {
        const msg = data.error || "Failed to change password";
        setPasswordErr(msg);
        toast.error(msg);
      }
    } catch (err) {
      const msg = "Network error — could not change password";
      setPasswordErr(msg);
      toast.error(msg);
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleUnlinkTelegram = async () => {
    setUnlinkLoading(true);
    try {
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unlink_telegram" }),
      });
      const data = await res.json();
      if (res.ok) {
        setProfile((p) => (p ? { ...p, telegram_chat_id: null } : p));
        toast.success(data.message || "Telegram unlinked");
      } else {
        toast.error(data.error || "Failed to unlink Telegram");
      }
    } catch {
      toast.error("Network error — could not unlink Telegram");
    } finally {
      setUnlinkLoading(false);
    }
  };

  if (loading || !user)
    return (
      <AppShellLoading
        showCartPanel={false}
        containerStyle={{
          maxWidth: 640,
          margin: "0 auto",
          padding: "24px 20px",
        }}
      />
    );

  return (
    <>
      <Navbar />
      <div
        className="page-container profile-page-shell"
        style={{ maxWidth: 640, margin: "0 auto", padding: "24px 20px" }}
      >
        <div
          className="page-header profile-page-header"
          style={{ marginBottom: 32 }}
        >
          <h1>
            <RiUserLine style={{ verticalAlign: "middle" }} /> Profile
          </h1>
          <p>Manage your account settings</p>
        </div>

        {/* User Info Card */}
        {profile && (
          <div
            className="glass-card profile-summary-card"
            style={{ padding: 28, marginBottom: 28 }}
          >
            <div
              className="profile-summary-head"
              style={{ display: "flex", alignItems: "center", gap: 20 }}
            >
              <div
                className="profile-summary-avatar"
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: "50%",
                  background: profile.role === "admin"
                    ? "linear-gradient(135deg, #f59e0b, #ef4444)"
                    : profile.role === "tech"
                      ? "linear-gradient(135deg, #10b981, #059669)"
                      : "linear-gradient(135deg, var(--accent), #818cf8)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: profileEmoji ? 34 : 28,
                  fontWeight: 700,
                  color: "white",
                  flexShrink: 0,
                  cursor: "pointer",
                  transition: "transform 0.15s ease",
                }}
                title="Click to change avatar emoji"
                onClick={() => setShowEmojiPicker(v => !v)}
                onMouseEnter={(e) => e.currentTarget.style.transform = "scale(1.08)"}
                onMouseLeave={(e) => e.currentTarget.style.transform = "scale(1)"}
              >
                {profileEmoji || profile.display_name[0].toUpperCase()}
              </div>
              <div style={{ flex: 1 }}>
                <h2
                  className="profile-summary-name"
                  style={{ margin: "0 0 4px 0", fontSize: 22 }}
                >
                  {profile.display_name}
                </h2>
                <p
                  className="profile-summary-username"
                  style={{
                    margin: "0 0 8px 0",
                    color: "var(--text-muted)",
                    fontSize: 14,
                  }}
                >
                  @{profile.username}
                </p>
                <span
                  className={`badge ${profile.role === "admin" ? "badge-warning" : profile.role === "tech" ? "badge-success" : "badge-info"}`}
                >
                  {profile.role === "admin" ? "🛡️ Admin" : profile.role === "tech" ? "🔧 Tech" : "👤 User"}
                </span>              </div>
            </div>
            <p
              className="profile-summary-meta"
              style={{
                fontSize: 13,
                color: "var(--text-muted)",
                marginTop: 16,
                marginBottom: 0,
                paddingTop: 16,
                borderTop: "1px solid var(--border)",
              }}
            >
              Member since{" "}
              {new Date(profile.created_at).toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </p>
          </div>
        )}

        {/* Emoji Picker */}
        {showEmojiPicker && profile && (
          <div
            className="glass-card profile-emoji-picker-card"
            style={{
              padding: 20,
              marginBottom: 28,
              animation: "fadeIn 0.2s ease",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 14,
              }}
            >
              <h3
                style={{
                  margin: 0,
                  fontSize: 15,
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <RiEmotionLine /> Choose Avatar Emoji
              </h3>
              <button
                type="button"
                aria-label="Close emoji picker"
                onClick={() => setShowEmojiPicker(false)}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  fontSize: 18,
                  padding: 4,
                }}
              >
                <RiCloseLine />
              </button>
            </div>
            <div
              className="emoji-grid"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(42px, 1fr))",
                gap: 6,
                maxHeight: 260,
                overflowY: "auto",
                padding: "4px 0",
              }}
            >
              {[
                "😀","😎","🤩","🥳","😇","🤓","🧐","😈",
                "🦊","🐱","🐶","🐼","🦁","🐯","🐸","🦄",
                "🔥","⚡","✨","💫","🌟","🌈","🎯","🎨",
                "💎","🏆","👑","🎭","🎪","🎬","🎮","🎲",
                "🚀","🛸","🌍","🌙","☀️","⭐","🍀","🌸",
                "🎵","🎶","🎤","🎸","🥁","🎹","🎺","🎻",
                "❤️","🧡","💛","💚","💙","💜","🖤","🤍",
                "🍕","🍔","🌮","🍩","🧁","🍰","🍦","🍣",
                "⚽","🏀","🎾","🏐","🏈","⚾","🎳","🏓",
                "🧸","🎁","🎈","🪄","🔮","🧲","💡","🔑",
              ].map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={async () => {
                    setProfileEmoji(emoji);
                    setEmojiSaving(true);
                    try {
                      const res = await fetch("/api/profile", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          action: "update_profile",
                          display_name: displayName,
                          telegram_handle: telegramHandle.trim().replace(/^@/, ""),
                          email: email.trim() || null,
                          ministry: ministry.trim() || null,
                          mute_emails: muteEmails,
                          mute_telegram: muteTelegram,
                          profile_emoji: emoji,
                        }),
                      });
                      if (res.ok) {
                        toast.success(`Avatar set to ${emoji}`);
                        checkAuth();
                      } else {
                        const data = await res.json().catch(() => ({}));
                        toast.error(data.error || "Failed to update emoji");
                        setProfileEmoji(profile.profile_emoji || null);
                      }
                    } catch {
                      toast.error("Network error");
                      setProfileEmoji(profile.profile_emoji || null);
                    } finally {
                      setEmojiSaving(false);
                    }
                  }}
                  disabled={emojiSaving}
                  style={{
                    fontSize: 24,
                    width: 42,
                    height: 42,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: profileEmoji === emoji
                      ? "rgba(99, 102, 241, 0.2)"
                      : "rgba(255,255,255,0.04)",
                    border: profileEmoji === emoji
                      ? "2px solid var(--accent)"
                      : "1px solid var(--border)",
                    borderRadius: 10,
                    cursor: emojiSaving ? "wait" : "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  {emoji}
                </button>
              ))}
            </div>
            {profileEmoji && (
              <button
                type="button"
                className="btn btn-outline"
                disabled={emojiSaving}
                onClick={async () => {
                  setProfileEmoji(null);
                  setEmojiSaving(true);
                  try {
                    const res = await fetch("/api/profile", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        action: "update_profile",
                        display_name: displayName,
                        telegram_handle: telegramHandle.trim().replace(/^@/, ""),
                        email: email.trim() || null,
                        ministry: ministry.trim() || null,
                        mute_emails: muteEmails,
                        mute_telegram: muteTelegram,
                        profile_emoji: "",
                      }),
                    });
                    if (res.ok) {
                      toast.success("Avatar reset to initial");
                      checkAuth();
                    } else {
                      const data = await res.json().catch(() => ({}));
                      toast.error(data.error || "Failed to reset emoji");
                      setProfileEmoji(profile.profile_emoji || null);
                    }
                  } catch {
                    toast.error("Network error");
                    setProfileEmoji(profile.profile_emoji || null);
                  } finally {
                    setEmojiSaving(false);
                  }
                }}
                style={{
                  marginTop: 12,
                  fontSize: 13,
                  padding: "8px 16px",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <RiCloseLine /> Remove Emoji (use initial)
              </button>
            )}
          </div>
        )}

        {/* Edit Display Name */}
        <div
          className="profile-section profile-section-edit"
          style={{
            padding: 32,
            marginBottom: 32,
            background: "rgba(255,255,255,0.03)",
            border: "1px solid var(--border)",
            borderRadius: 16,
          }}
        >
          <h3
            className="profile-section-title"
            style={{
              marginTop: 0,
              marginBottom: 28,
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontSize: 18,
              paddingBottom: 16,
              borderBottom: "1px solid var(--border)",
            }}
          >
            <RiUserLine /> Edit Profile
          </h3>
          <form onSubmit={handleUpdateProfile}>
            <div style={{ marginBottom: 24 }}>
              <label
                className="profile-label"
                style={{
                  display: "block",
                  marginBottom: 12,
                  fontSize: 14,
                  fontWeight: 600,
                  color: "var(--text-secondary)",
                  letterSpacing: "0.5px",
                }}
              >
                Display Name
              </label>
              <input
                className="profile-input"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your display name"
                required
                minLength={2}
                autoComplete="name"
                style={{
                  width: "100%",
                  padding: "14px 18px",
                  background: "var(--bg-card)",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  color: "var(--text-primary)",
                  fontSize: 16,
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>
            <div style={{ marginBottom: 24 }}>
              <label
                className="profile-label"
                style={{
                  display: "block",
                  marginBottom: 12,
                  fontSize: 14,
                  fontWeight: 600,
                  color: "var(--text-secondary)",
                  letterSpacing: "0.5px",
                }}
              >
                Telegram Handle{" "}
                <span style={{ fontWeight: 400, fontSize: 12, color: "var(--error)" }}>
                  *
                </span>
              </label>
              <input
                className="profile-input"
                type="text"
                value={telegramHandle}
                onChange={(e) => setTelegramHandle(e.target.value)}
                placeholder="@yourhandle"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                style={{
                  width: "100%",
                  padding: "14px 18px",
                  background: "var(--bg-card)",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  color: "var(--text-primary)",
                  fontSize: 16,
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>
            <div style={{ marginBottom: 24 }}>
              <label
                className="profile-label"
                style={{
                  display: "block",
                  marginBottom: 12,
                  fontSize: 14,
                  fontWeight: 600,
                  color: "var(--text-secondary)",
                  letterSpacing: "0.5px",
                }}
              >
                <RiMailLine
                  style={{ verticalAlign: "middle", marginRight: 6 }}
                />
                Email for Notifications{" "}
                <span style={{ fontWeight: 400, fontSize: 12 }}>
                  (optional)
                </span>
              </label>
              <input
                className="profile-input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com — for loan reminders"
                autoCapitalize="off"
                autoCorrect="off"
                autoComplete="email"
                style={{
                  width: "100%",
                  padding: "14px 18px",
                  background: "var(--bg-card)",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  color: "var(--text-primary)",
                  fontSize: 16,
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>
            <div style={{ marginBottom: 24 }}>
              <label
                className="profile-label"
                style={{
                  display: "block",
                  marginBottom: 12,
                  fontSize: 14,
                  fontWeight: 600,
                  color: "var(--text-secondary)",
                  letterSpacing: "0.5px",
                }}
              >
                Ministry / Department{" "}
                <span style={{ fontWeight: 400, fontSize: 12 }}>(optional)</span>
              </label>
              <select
                className="profile-input"
                value={ministryIsOther ? "Others" : ministry}
                onChange={(e) => {
                  if (e.target.value === "Others") {
                    setMinistryIsOther(true);
                    setMinistry("");
                  } else {
                    setMinistryIsOther(false);
                    setMinistry(e.target.value);
                  }
                }}
                style={{
                  width: "100%",
                  padding: "14px 18px",
                  background: "var(--bg-card)",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  color: ministry || ministryIsOther ? "var(--text-primary)" : "var(--text-muted)",
                  fontSize: 16,
                  outline: "none",
                  boxSizing: "border-box",
                  cursor: "pointer",
                }}
              >
                <option value="">— Select ministry —</option>
                {MINISTRY_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
                <option value="Others">Others</option>
              </select>
              {ministryIsOther && (
                <input
                  className="profile-input"
                  type="text"
                  value={ministry}
                  onChange={(e) => setMinistry(e.target.value)}
                  placeholder="Enter your ministry or department"
                  autoCapitalize="words"
                  style={{
                    width: "100%",
                    padding: "14px 18px",
                    marginTop: 10,
                    background: "var(--bg-card)",
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    color: "var(--text-primary)",
                    fontSize: 16,
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
              )}
            </div>

            <div
              className="profile-helper-block profile-telegram-block"
              style={{
                marginBottom: 24,
                padding: 20,
                background: "rgba(56, 189, 248, 0.05)",
                borderRadius: 12,
                border: "1px solid rgba(56, 189, 248, 0.15)",
              }}
            >
              <label
                className="profile-label"
                style={{
                  display: "block",
                  marginBottom: 8,
                  fontSize: 14,
                  fontWeight: 600,
                  color: "var(--text-secondary)",
                  letterSpacing: "0.5px",
                }}
              >
                Telegram Notifications
              </label>
              <p
                style={{
                  fontSize: 13,
                  color: "var(--text-muted)",
                  marginBottom: 16,
                }}
              >
                Receive instant alerts for loan approvals, returns, and overdue
                items.
              </p>

              {profileErr &&
              profileErr.includes(
                "Telegram",
              ) ? null : profile?.telegram_chat_id ? (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <div
                    className="profile-status-pill"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      background: "rgba(34, 197, 94, 0.1)",
                      color: "#22c55e",
                      padding: "8px 14px",
                      borderRadius: 8,
                      fontSize: 13,
                      fontWeight: 500,
                    }}
                  >
                    <RiCheckLine size={16} /> Linked & Active
                  </div>
                  <button
                    type="button"
                    className="btn btn-outline"
                    style={{ fontSize: 12, padding: "6px 12px" }}
                    onClick={handleUnlinkTelegram}
                    disabled={unlinkLoading}
                  >
                    {unlinkLoading ? (
                      <span className="btn-spinner" />
                    ) : (
                      "Unlink"
                    )}
                  </button>
                </div>
              ) : (
                <div
                  className="profile-helper-card"
                  style={{
                    background: "rgba(56, 189, 248, 0.1)",
                    padding: 16,
                    borderRadius: 8,
                    marginTop: 12,
                  }}
                >
                  <p
                    style={{
                      fontSize: 13,
                      color: "var(--text-primary)",
                      marginBottom: 12,
                      fontWeight: 500,
                    }}
                  >
                    To link your account:
                  </p>
                  <ol
                    style={{
                      fontSize: 13,
                      color: "var(--text-muted)",
                      margin: "0 0 16px 0",
                      paddingLeft: 20,
                    }}
                  >
                    <li style={{ marginBottom: 6 }}>
                      Click the button below to open Telegram
                    </li>
                    <li style={{ marginBottom: 6 }}>
                      Press <strong>Start</strong> at the bottom of the chat
                    </li>
                    <li>
                      Wait for the confirmation message, then{" "}
                      <strong>refresh this page</strong>.
                    </li>
                  </ol>
                  <a
                    href={`https://t.me/${process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || "HOGC_Tech_Bot"}?start=${user.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-outline"
                    style={{
                      background: "#38bdf8",
                      color: "#fff",
                      border: "none",
                      padding: "10px 18px",
                      display: "inline-block",
                    }}
                  >
                    Open Telegram to Link
                  </a>
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={handleRefreshTelegramStatus}
                    disabled={linkStatusLoading}
                    style={{ marginLeft: 10 }}
                  >
                    {linkStatusLoading ? "Checking..." : "Check Link Status"}
                  </button>
                </div>
              )}
            </div>

            {/* Notification mute toggles */}
            <div
              className="profile-helper-block profile-toggle-block"
              style={{
                marginBottom: 24,
                padding: 20,
                background: "rgba(255,255,255,0.03)",
                borderRadius: 12,
                border: "1px solid var(--border)",
              }}
            >
              <label
                className="profile-label"
                style={{
                  display: "block",
                  marginBottom: 12,
                  fontSize: 14,
                  fontWeight: 600,
                  color: "var(--text-secondary)",
                  letterSpacing: "0.5px",
                }}
              >
                <RiNotificationOffLine
                  style={{ verticalAlign: "middle", marginRight: 6 }}
                />
                Notification Mute Settings
              </label>
              <div
                style={{ display: "flex", flexDirection: "column", gap: 12 }}
              >
                <label
                  className="profile-toggle-row"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    cursor: "pointer",
                    padding: "10px 14px",
                    background: "var(--bg-card)",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                  }}
                >
                  <span
                    className="profile-toggle-text"
                    style={{ fontSize: 14, color: "var(--text-primary)" }}
                  >
                    Mute email notifications
                  </span>
                  <input
                    type="checkbox"
                    checked={muteEmails}
                    onChange={(e) => setMuteEmails(e.target.checked)}
                    style={{
                      width: 18,
                      height: 18,
                      accentColor: "var(--accent)",
                      cursor: "pointer",
                      flexShrink: 0,
                    }}
                  />
                </label>
                <label
                  className="profile-toggle-row"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    cursor: "pointer",
                    padding: "10px 14px",
                    background: "var(--bg-card)",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                  }}
                >
                  <span
                    className="profile-toggle-text"
                    style={{ fontSize: 14, color: "var(--text-primary)" }}
                  >
                    Mute Telegram notifications
                  </span>
                  <input
                    type="checkbox"
                    checked={muteTelegram}
                    onChange={(e) => setMuteTelegram(e.target.checked)}
                    style={{
                      width: 18,
                      height: 18,
                      accentColor: "var(--accent)",
                      cursor: "pointer",
                      flexShrink: 0,
                    }}
                  />
                </label>
                <p
                  className="profile-muted-note"
                  style={{
                    margin: 0,
                    fontSize: 12,
                    color: "var(--text-muted)",
                  }}
                >
                  You can also mute/unmute Telegram by sending /mute or /unmute
                  to the bot.
                </p>
              </div>
            </div>

            {profileMsg && (
              <p
                className="profile-feedback profile-feedback-success"
                style={{
                  color: "var(--success)",
                  fontSize: 14,
                  marginBottom: 20,
                  padding: "12px 16px",
                  background: "rgba(34,197,94,0.08)",
                  borderRadius: 10,
                }}
              >
                ✅ {profileMsg}
              </p>
            )}
            {profileErr && (
              <p
                className="profile-feedback profile-feedback-error"
                style={{
                  color: "var(--error)",
                  fontSize: 14,
                  marginBottom: 20,
                  padding: "12px 16px",
                  background: "rgba(239,68,68,0.08)",
                  borderRadius: 10,
                }}
              >
                ❌ {profileErr}
              </p>
            )}
            <button
              type="submit"
              className="btn btn-primary profile-submit-btn"
              style={{ padding: "14px 28px", fontSize: 14, marginTop: 4 }}
              disabled={profileLoading}
            >
              {profileLoading ? (
                <>
                  <span className="btn-spinner" /> Saving…
                </>
              ) : (
                <>
                  <RiCheckLine /> Save Changes
                </>
              )}
            </button>
          </form>
        </div>

        {/* Change Password */}
        <div
          className="profile-section profile-section-password"
          style={{
            padding: 32,
            marginBottom: 32,
            background: "rgba(255,255,255,0.03)",
            border: "1px solid var(--border)",
            borderRadius: 16,
          }}
        >
          <h3
            className="profile-section-title"
            style={{
              marginTop: 0,
              marginBottom: 28,
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontSize: 18,
              paddingBottom: 16,
              borderBottom: "1px solid var(--border)",
            }}
          >
            <RiLockLine /> Change Password
          </h3>
          <form onSubmit={handleChangePassword}>
            <div style={{ marginBottom: 28 }}>
              <label
                className="profile-label"
                style={{
                  display: "block",
                  marginBottom: 12,
                  fontSize: 14,
                  fontWeight: 600,
                  color: "var(--text-secondary)",
                  letterSpacing: "0.5px",
                }}
              >
                Current Password
              </label>
              <input
                className="profile-input"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter current password"
                required
                autoCapitalize="off"
                autoCorrect="off"
                autoComplete="current-password"
                style={{
                  width: "100%",
                  padding: "14px 18px",
                  background: "var(--bg-card)",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  color: "var(--text-primary)",
                  fontSize: 16,
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>
            <div style={{ marginBottom: 28 }}>
              <label
                className="profile-label"
                style={{
                  display: "block",
                  marginBottom: 12,
                  fontSize: 14,
                  fontWeight: 600,
                  color: "var(--text-secondary)",
                  letterSpacing: "0.5px",
                }}
              >
                New Password
              </label>
              <input
                className="profile-input"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password (min. 6 chars)"
                required
                minLength={6}
                autoCapitalize="off"
                autoCorrect="off"
                autoComplete="new-password"
                style={{
                  width: "100%",
                  padding: "14px 18px",
                  background: "var(--bg-card)",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  color: "var(--text-primary)",
                  fontSize: 16,
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>
            <div style={{ marginBottom: 28 }}>
              <label
                className="profile-label"
                style={{
                  display: "block",
                  marginBottom: 12,
                  fontSize: 14,
                  fontWeight: 600,
                  color: "var(--text-secondary)",
                  letterSpacing: "0.5px",
                }}
              >
                Confirm New Password
              </label>
              <input
                className="profile-input"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                required
                autoCapitalize="off"
                autoCorrect="off"
                autoComplete="new-password"
                style={{
                  width: "100%",
                  padding: "14px 18px",
                  background: "var(--bg-card)",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  color: "var(--text-primary)",
                  fontSize: 16,
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>
            {passwordMsg && (
              <p
                className="profile-feedback profile-feedback-success"
                style={{
                  color: "var(--success)",
                  fontSize: 14,
                  marginBottom: 20,
                  padding: "12px 16px",
                  background: "rgba(34,197,94,0.08)",
                  borderRadius: 10,
                }}
              >
                ✅ {passwordMsg}
              </p>
            )}
            {passwordErr && (
              <p
                className="profile-feedback profile-feedback-error"
                style={{
                  color: "var(--error)",
                  fontSize: 14,
                  marginBottom: 20,
                  padding: "12px 16px",
                  background: "rgba(239,68,68,0.08)",
                  borderRadius: 10,
                }}
              >
                ❌ {passwordErr}
              </p>
            )}
            <button
              type="submit"
              className="btn btn-primary profile-submit-btn"
              style={{ padding: "14px 28px", fontSize: 14, marginTop: 4 }}
              disabled={passwordLoading}
            >
              {passwordLoading ? (
                <>
                  <span className="btn-spinner" /> Updating…
                </>
              ) : (
                <>
                  <RiLockLine /> Change Password
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
