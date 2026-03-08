"use client";

import { useState, useMemo } from "react";
import type { HomeworkItem } from "@/lib/types";

interface HomeworkListProps {
  homework: HomeworkItem[];
}

type TimeFilter = "all" | "upcoming" | "past" | "this_week" | "this_month";
type StatusFilter = "all" | "not_submitted" | "on_time" | "late";

const STATUS_CONFIG = {
  not_submitted: {
    label: "Not Submitted",
    bg: "bg-red-50",
    border: "border-red-200",
    text: "text-red-700",
    dot: "bg-red-500",
  },
  on_time: {
    label: "Submitted",
    bg: "bg-green-50",
    border: "border-green-200",
    text: "text-green-700",
    dot: "bg-green-500",
  },
  late: {
    label: "Late",
    bg: "bg-amber-50",
    border: "border-amber-200",
    text: "text-amber-700",
    dot: "bg-amber-500",
  },
};

export default function HomeworkList({ homework }: HomeworkListProps) {
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [subjectFilter, setSubjectFilter] = useState<string>("all");
  const [semesterFilter, setSemesterFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Unique subjects for filter dropdown
  const subjects = useMemo(() => {
    const set = new Set(homework.map((h) => h.subjectName));
    return Array.from(set).sort();
  }, [homework]);

  // Unique semesters
  const semesters = useMemo(() => {
    const set = new Set(
      homework.map((h) => `${h.tahun} Semester ${h.semester}`)
    );
    return Array.from(set).sort().reverse();
  }, [homework]);

  const filtered = useMemo(() => {
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay() + 1);
    startOfWeek.setHours(0, 0, 0, 0);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 7);

    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    return homework.filter((item) => {
      // Time filter
      const deadline = new Date(item.deadline);
      if (timeFilter === "upcoming" && deadline < now) return false;
      if (timeFilter === "past" && deadline >= now) return false;
      if (timeFilter === "this_week" && (deadline < startOfWeek || deadline >= endOfWeek)) return false;
      if (timeFilter === "this_month" && (deadline < startOfMonth || deadline > endOfMonth)) return false;

      // Status filter
      if (statusFilter !== "all" && item.status !== statusFilter) return false;

      // Subject filter
      if (subjectFilter !== "all" && item.subjectName !== subjectFilter) return false;

      // Semester filter
      if (semesterFilter !== "all") {
        const key = `${item.tahun} Semester ${item.semester}`;
        if (key !== semesterFilter) return false;
      }

      // Search
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (
          !item.title.toLowerCase().includes(q) &&
          !item.subjectName.toLowerCase().includes(q) &&
          !item.description.toLowerCase().includes(q)
        )
          return false;
      }

      return true;
    });
  }, [homework, timeFilter, statusFilter, subjectFilter, semesterFilter, searchQuery]);

  // Stats
  const stats = useMemo(() => {
    const total = homework.length;
    const notSubmitted = homework.filter((h) => h.status === "not_submitted").length;
    const upcoming = homework.filter((h) => new Date(h.deadline) >= new Date()).length;
    const submitted = homework.filter((h) => h.status === "on_time" || h.status === "late").length;
    return { total, notSubmitted, upcoming, submitted };
  }, [homework]);

  function getDeadlineLabel(deadline: string): string {
    const now = new Date();
    const dl = new Date(deadline);
    const diffMs = dl.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays < 0) return `${Math.abs(diffDays)} days ago`;
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Tomorrow";
    if (diffDays <= 7) return `${diffDays} days left`;
    return `${diffDays} days left`;
  }

  function isOverdue(deadline: string): boolean {
    return new Date(deadline) < new Date();
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 font-medium">Total Homework</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{stats.total}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 font-medium">Not Submitted</p>
          <p className="text-2xl font-bold text-red-600 mt-1">{stats.notSubmitted}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 font-medium">Upcoming</p>
          <p className="text-2xl font-bold text-blue-600 mt-1">{stats.upcoming}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 font-medium">Submitted</p>
          <p className="text-2xl font-bold text-green-600 mt-1">{stats.submitted}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {/* Search */}
          <div className="lg:col-span-1">
            <input
              type="text"
              placeholder="Search homework..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>

          {/* Time filter */}
          <select
            value={timeFilter}
            onChange={(e) => setTimeFilter(e.target.value as TimeFilter)}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
          >
            <option value="all">All Time</option>
            <option value="upcoming">Upcoming</option>
            <option value="past">Past Due</option>
            <option value="this_week">This Week</option>
            <option value="this_month">This Month</option>
          </select>

          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
          >
            <option value="all">All Status</option>
            <option value="not_submitted">Not Submitted</option>
            <option value="on_time">Submitted</option>
            <option value="late">Late</option>
          </select>

          {/* Subject filter */}
          <select
            value={subjectFilter}
            onChange={(e) => setSubjectFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
          >
            <option value="all">All Subjects</option>
            {subjects.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          {/* Semester filter */}
          <select
            value={semesterFilter}
            onChange={(e) => setSemesterFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
          >
            <option value="all">All Semesters</option>
            {semesters.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Results count */}
      <p className="text-sm text-gray-500">
        Showing {filtered.length} of {homework.length} homework items
      </p>

      {/* Homework list */}
      {filtered.length > 0 ? (
        <div className="space-y-3">
          {filtered.map((item) => {
            const cfg = STATUS_CONFIG[item.status];
            const overdue = isOverdue(item.deadline) && item.status === "not_submitted";

            return (
              <div
                key={`${item.id}-${item.subjectNomor}`}
                className={`bg-white rounded-xl border ${
                  overdue ? "border-red-300 bg-red-50/30" : "border-gray-200"
                } p-4 hover:shadow-sm transition-shadow`}
              >
                <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                  {/* Left: main info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-2 flex-wrap">
                      <h3 className="text-sm font-semibold text-gray-900 truncate">
                        {item.title}
                      </h3>
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full ${cfg.bg} ${cfg.text} ${cfg.border} border`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                        {cfg.label}
                      </span>
                    </div>

                    <p className="text-xs text-blue-600 font-medium mt-1">
                      {item.subjectName}
                    </p>

                    {item.description && (
                      <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                        {item.description.length > 150
                          ? item.description.substring(0, 150) + "..."
                          : item.description}
                      </p>
                    )}

                    <div className="flex items-center gap-4 mt-2 flex-wrap">
                      <span className="text-xs text-gray-400">
                        {item.tahun} Sem {item.semester}
                      </span>
                      {item.fileCount > 0 && (
                        <span className="text-xs text-gray-400">
                          📎 {item.fileCount} file{item.fileCount > 1 ? "s" : ""}
                        </span>
                      )}
                      {item.submissionTimeIndonesia && (
                        <span className="text-xs text-gray-400">
                          Submitted: {item.submissionTimeIndonesia}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Right: deadline */}
                  <div className="sm:text-right shrink-0">
                    <p
                      className={`text-xs font-semibold ${
                        overdue ? "text-red-600" : "text-gray-700"
                      }`}
                    >
                      {getDeadlineLabel(item.deadline)}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {item.deadlineIndonesia}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
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
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
            />
          </svg>
          <p className="text-gray-500">
            No homework found matching your filters.
          </p>
        </div>
      )}
    </div>
  );
}
