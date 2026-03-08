"use client";

import { useState, useMemo } from "react";
import type { AttendanceItem } from "@/lib/types";

interface AttendanceListProps {
  attendance: AttendanceItem[];
}

type SemesterFilter = "all" | string;

export default function AttendanceList({ attendance }: AttendanceListProps) {
  const [semesterFilter, setSemesterFilter] = useState<SemesterFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedSubject, setExpandedSubject] = useState<number | null>(null);

  // Unique semesters for filter dropdown
  const semesters = useMemo(() => {
    const set = new Set(
      attendance.map((a) => `${a.tahun} Semester ${a.semester}`)
    );
    return Array.from(set).sort().reverse();
  }, [attendance]);

  const filtered = useMemo(() => {
    return attendance.filter((item) => {
      // Semester filter
      if (semesterFilter !== "all") {
        const key = `${item.tahun} Semester ${item.semester}`;
        if (key !== semesterFilter) return false;
      }

      // Search
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (!item.subjectName.toLowerCase().includes(q)) return false;
      }

      return true;
    });
  }, [attendance, semesterFilter, searchQuery]);

  // Stats
  const stats = useMemo(() => {
    const totalSubjects = attendance.length;
    const totalSessions = attendance.reduce(
      (acc, a) => acc + a.totalSessions,
      0
    );
    const totalAttended = attendance.reduce(
      (acc, a) => acc + a.attendedSessions,
      0
    );
    const overallRate =
      totalSessions > 0
        ? Math.round((totalAttended / totalSessions) * 100)
        : 0;
    return { totalSubjects, totalSessions, totalAttended, overallRate };
  }, [attendance]);

  function toggleExpand(subjectNomor: number) {
    setExpandedSubject((prev) =>
      prev === subjectNomor ? null : subjectNomor
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 font-medium">Subjects</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">
            {stats.totalSubjects}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 font-medium">Total Sessions</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">
            {stats.totalSessions}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 font-medium">Attended</p>
          <p className="text-2xl font-bold text-green-600 mt-1">
            {stats.totalAttended}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 font-medium">Overall Rate</p>
          <p
            className={`text-2xl font-bold mt-1 ${
              stats.overallRate >= 80
                ? "text-green-600"
                : stats.overallRate >= 60
                  ? "text-amber-600"
                  : "text-red-600"
            }`}
          >
            {stats.overallRate}%
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Search */}
          <input
            type="text"
            placeholder="Search subject..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          />

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
        Showing {filtered.length} of {attendance.length} subjects
      </p>

      {/* Attendance list */}
      {filtered.length > 0 ? (
        <div className="space-y-3">
          {filtered.map((item) => {
            const isExpanded = expandedSubject === item.subjectNomor;
            const rateColor =
              item.attendanceRate >= 80
                ? "text-green-600"
                : item.attendanceRate >= 60
                  ? "text-amber-600"
                  : "text-red-600";
            const rateBg =
              item.attendanceRate >= 80
                ? "bg-green-50 border-green-200"
                : item.attendanceRate >= 60
                  ? "bg-amber-50 border-amber-200"
                  : "bg-red-50 border-red-200";

            return (
              <div
                key={`${item.subjectNomor}-${item.tahun}-${item.semester}`}
                className="bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-sm transition-shadow"
              >
                <button
                  onClick={() => toggleExpand(item.subjectNomor)}
                  className="w-full p-4 text-left"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    {/* Left: subject info */}
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-semibold text-gray-900 truncate">
                        {item.subjectName}
                      </h3>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {item.tahun} Sem {item.semester}
                      </p>
                    </div>

                    {/* Middle: progress bar */}
                    <div className="flex-1 max-w-xs">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              item.attendanceRate >= 80
                                ? "bg-green-500"
                                : item.attendanceRate >= 60
                                  ? "bg-amber-500"
                                  : "bg-red-500"
                            }`}
                            style={{
                              width: `${item.attendanceRate}%`,
                            }}
                          />
                        </div>
                        <span
                          className={`text-xs font-semibold ${rateColor} w-10 text-right`}
                        >
                          {item.attendanceRate}%
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {item.attendedSessions} of {item.totalSessions} sessions
                      </p>
                    </div>

                    {/* Right: badge + expand */}
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full border ${rateBg} ${rateColor}`}
                      >
                        {item.attendedSessions}/{item.totalSessions}
                      </span>
                      <svg
                        className={`w-4 h-4 text-gray-400 transition-transform ${
                          isExpanded ? "rotate-180" : ""
                        }`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M19 9l-7 7-7-7"
                        />
                      </svg>
                    </div>
                  </div>
                </button>

                {/* Expanded: session history */}
                {isExpanded && item.history.length > 0 && (
                  <div className="border-t border-gray-100 px-4 py-3 bg-gray-50">
                    <p className="text-xs font-medium text-gray-500 mb-2">
                      Attendance History
                    </p>
                    <div className="space-y-1.5 max-h-60 overflow-y-auto">
                      {item.history.map((entry, idx) => (
                        <div
                          key={entry.key}
                          className="flex items-center gap-2 text-xs"
                        >
                          <span className="w-5 text-gray-400 text-right">
                            {idx + 1}.
                          </span>
                          <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
                          <span className="text-gray-700">{entry.date}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
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
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <p className="text-gray-500">
            No attendance data found matching your filters.
          </p>
        </div>
      )}
    </div>
  );
}
