"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import LoginForm from "@/components/LoginForm";
import ScheduleGrid from "@/components/ScheduleGrid";
import HomeworkList from "@/components/HomeworkList";
import AttendanceList from "@/components/AttendanceList";
import NotificationPanel from "@/components/NotificationPanel";
import type { CourseSchedule, HomeworkItem, AttendanceItem } from "@/lib/types";

type AppState = "loading" | "login" | "dashboard";
type Tab = "schedule" | "homework" | "attendance" | "notifications";

export default function Home() {
  const [state, setState] = useState<AppState>("loading");
  const [tab, setTab] = useState<Tab>("schedule");
  const [schedules, setSchedules] = useState<CourseSchedule[]>([]);
  const [homework, setHomework] = useState<HomeworkItem[]>([]);
  const [attendance, setAttendance] = useState<AttendanceItem[]>([]);
  const [fetching, setFetching] = useState(false);
  const [fetchingHomework, setFetchingHomework] = useState(false);
  const [fetchingAttendance, setFetchingAttendance] = useState(false);
  const [fetchingNotifications, setFetchingNotifications] = useState(false);
  const [notificationRefreshNonce, setNotificationRefreshNonce] = useState(0);
  const [error, setError] = useState("");
  const homeworkFetched = useRef(false);
  const attendanceFetched = useRef(false);

  const fetchSchedule = useCallback(async () => {
    setFetching(true);
    setError("");

    try {
      const res = await fetch("/api/schedule");
      const data = await res.json();

      if (data.success) {
        setSchedules(data.data);
        setState("dashboard");
      } else if (res.status === 401) {
        setError(data.error || "Session expired. Please login again.");
        setState("login");
      } else {
        setError(data.error || "Failed to fetch schedule");
        setState("dashboard");
      }
    } catch {
      setError("Network error. Make sure the server is running.");
      setState("login");
    } finally {
      setFetching(false);
    }
  }, []);

  const fetchHomework = useCallback(async () => {
    setFetchingHomework(true);
    setError("");

    try {
      const res = await fetch("/api/homework");
      const data = await res.json();

      if (data.success) {
        setHomework(data.data);
        homeworkFetched.current = true;
      } else if (res.status === 401) {
        setError(data.error || "Session expired. Please login again.");
        setState("login");
      } else {
        setError(data.error || "Failed to fetch homework");
      }
    } catch {
      setError("Network error. Make sure the server is running.");
    } finally {
      setFetchingHomework(false);
    }
  }, []);

  const fetchAttendance = useCallback(async () => {
    setFetchingAttendance(true);
    setError("");

    try {
      const res = await fetch("/api/attendance");
      const data = await res.json();

      if (data.success) {
        setAttendance(data.data);
        attendanceFetched.current = true;
      } else if (res.status === 401) {
        setError(data.error || "Session expired. Please login again.");
        setState("login");
      } else {
        setError(data.error || "Failed to fetch attendance");
      }
    } catch {
      setError("Network error. Make sure the server is running.");
    } finally {
      setFetchingAttendance(false);
    }
  }, []);

  useEffect(() => {
    fetchSchedule();
  }, [fetchSchedule]);

  // Lazy-load homework when user first switches to homework tab
  useEffect(() => {
    if (
      tab === "homework" &&
      !homeworkFetched.current &&
      state === "dashboard"
    ) {
      fetchHomework();
    }
  }, [tab, state, fetchHomework]);

  // Lazy-load attendance when user first switches to attendance tab
  useEffect(() => {
    if (
      tab === "attendance" &&
      !attendanceFetched.current &&
      state === "dashboard"
    ) {
      fetchAttendance();
    }
  }, [tab, state, fetchAttendance]);

  function handleLoginSuccess() {
    setState("loading");
    homeworkFetched.current = false;
    attendanceFetched.current = false;
    setHomework([]);
    setAttendance([]);
    fetchSchedule();
  }

  async function handleLogout() {
    try {
      await fetch("/api/logout", { method: "POST" });
    } catch {}
    setState("login");
    setSchedules([]);
    setHomework([]);
    setAttendance([]);
    setError("");
    setTab("schedule");
    homeworkFetched.current = false;
    attendanceFetched.current = false;
  }

  function handleRefresh() {
    if (tab === "schedule") {
      fetchSchedule();
    } else if (tab === "homework") {
      homeworkFetched.current = false;
      fetchHomework();
    } else if (tab === "attendance") {
      attendanceFetched.current = false;
      fetchAttendance();
    } else {
      setNotificationRefreshNonce((current) => current + 1);
    }
  }

  const isRefreshing =
    tab === "schedule"
      ? fetching
      : tab === "homework"
        ? fetchingHomework
        : tab === "attendance"
          ? fetchingAttendance
          : fetchingNotifications;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center">
                <svg
                  className="w-5 h-5 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
              </div>
              <div>
                <h1 className="text-lg font-bold text-gray-900">
                  ETHOL Portal
                </h1>
                <p className="text-xs text-gray-500 -mt-0.5">
                  Schedule, Homework, Attendance & Notifications
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {state === "dashboard" && (
                <>
                  <button
                    onClick={handleRefresh}
                    disabled={isRefreshing}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
                  >
                    <svg
                      className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                      />
                    </svg>
                    Refresh
                  </button>
                  <button
                    onClick={handleLogout}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-600 bg-white border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
                  >
                    Logout
                  </button>
                </>
              )}

              <div
                className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                  state === "dashboard"
                    ? "bg-green-100 text-green-700"
                    : "bg-gray-100 text-gray-500"
                }`}
              >
                {state === "dashboard" ? "Connected" : "Not Connected"}
              </div>
            </div>
          </div>

          {/* Tab Navigation */}
          {state === "dashboard" && (
            <div className="flex gap-1 -mb-px">
              <button
                onClick={() => setTab("schedule")}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  tab === "schedule"
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
              >
                <span className="inline-flex items-center gap-1.5">
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                    />
                  </svg>
                  Schedule
                </span>
              </button>
              <button
                onClick={() => setTab("homework")}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  tab === "homework"
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
              >
                <span className="inline-flex items-center gap-1.5">
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                    />
                  </svg>
                  Homework
                  {homework.length > 0 && (
                    <span className="ml-1 bg-blue-100 text-blue-700 text-xs font-semibold px-1.5 py-0.5 rounded-full">
                      {homework.length}
                    </span>
                  )}
                </span>
              </button>
              <button
                onClick={() => setTab("attendance")}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  tab === "attendance"
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
              >
                <span className="inline-flex items-center gap-1.5">
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  Attendance
                  {attendance.length > 0 && (
                    <span className="ml-1 bg-green-100 text-green-700 text-xs font-semibold px-1.5 py-0.5 rounded-full">
                      {attendance.length}
                    </span>
                  )}
                </span>
              </button>
              <button
                onClick={() => setTab("notifications")}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  tab === "notifications"
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
              >
                <span className="inline-flex items-center gap-1.5">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                  Notifications
                </span>
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Loading State */}
        {state === "loading" && (
          <div className="flex flex-col items-center justify-center py-32">
            <svg
              className="animate-spin h-8 w-8 text-blue-600 mb-4"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            <p className="text-sm text-gray-500">
              Loading schedule data...
            </p>
          </div>
        )}

        {/* Login State */}
        {state === "login" && (
          <div className="py-16">
            {error && (
              <div className="w-full max-w-md mx-auto mb-4">
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
                  {error}
                </div>
              </div>
            )}
            <LoginForm onLoginSuccess={handleLoginSuccess} />
          </div>
        )}

        {/* Dashboard State */}
        {state === "dashboard" && (
          <div className="space-y-6">
            {/* Error display */}
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
                {error}
              </div>
            )}

            {/* Schedule Tab */}
            {tab === "schedule" && (
              <>
                {/* Stats bar */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="bg-white rounded-xl border border-gray-200 p-4">
                    <p className="text-xs text-gray-500 font-medium">
                      Total Courses
                    </p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">
                      {new Set(schedules.map((s) => s.subjectName)).size}
                    </p>
                  </div>
                  <div className="bg-white rounded-xl border border-gray-200 p-4">
                    <p className="text-xs text-gray-500 font-medium">
                      Weekly Sessions
                    </p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">
                      {schedules.length}
                    </p>
                  </div>
                  <div className="bg-white rounded-xl border border-gray-200 p-4">
                    <p className="text-xs text-gray-500 font-medium">
                      Days with Class
                    </p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">
                      {new Set(schedules.map((s) => s.hari)).size}
                    </p>
                  </div>
                  <div className="bg-white rounded-xl border border-gray-200 p-4">
                    <p className="text-xs text-gray-500 font-medium">
                      Total Hours/Week
                    </p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">
                      {schedules
                        .reduce((acc, s) => {
                          const [sh, sm] = s.jamAwal.split(":").map(Number);
                          const [eh, em] = s.jamAkhir.split(":").map(Number);
                          return acc + (eh * 60 + em - (sh * 60 + sm)) / 60;
                        }, 0)
                        .toFixed(1)}
                    </p>
                  </div>
                </div>

                {/* Schedule Grid */}
                {schedules.length > 0 ? (
                  <ScheduleGrid schedules={schedules} />
                ) : (
                  !fetching &&
                  !error && (
                    <div className="text-center py-20">
                      <svg
                        className="w-16 h-16 text-gray-300 mx-auto mb-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.5}
                          d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                        />
                      </svg>
                      <p className="text-gray-500">
                        No schedule data found. Try refreshing.
                      </p>
                    </div>
                  )
                )}
              </>
            )}

            {/* Homework Tab */}
            {tab === "homework" && (
              <>
                {fetchingHomework ? (
                  <div className="flex flex-col items-center justify-center py-32">
                    <svg
                      className="animate-spin h-8 w-8 text-blue-600 mb-4"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                    <p className="text-sm text-gray-500">
                      Fetching homework across all semesters...
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      This may take a moment
                    </p>
                  </div>
                ) : (
                  <HomeworkList homework={homework} />
                )}
              </>
            )}

            {/* Attendance Tab */}
            {tab === "attendance" && (
              <>
                {fetchingAttendance ? (
                  <div className="flex flex-col items-center justify-center py-32">
                    <svg
                      className="animate-spin h-8 w-8 text-blue-600 mb-4"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                    <p className="text-sm text-gray-500">
                      Fetching attendance across all semesters...
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      This may take a moment
                    </p>
                  </div>
                ) : (
                  <AttendanceList attendance={attendance} />
                )}
              </>
            )}

            {/* Notifications Tab */}
            {tab === "notifications" && (
              <NotificationPanel
                refreshNonce={notificationRefreshNonce}
                isRefreshing={fetchingNotifications}
                onRefreshingChange={setFetchingNotifications}
              />
            )}
          </div>
        )}
      </main>
    </div>
  );
}
