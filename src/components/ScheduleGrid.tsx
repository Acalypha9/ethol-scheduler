"use client";

import type { CourseSchedule } from "@/lib/types";

interface ScheduleGridProps {
  schedules: CourseSchedule[];
}

const DAYS = ["Senin", "Selasa", "Rabu", "Kamis", "Jum'at"];
const DAY_NUMBERS: Record<string, number> = {
  Senin: 1,
  Selasa: 2,
  Rabu: 3,
  Kamis: 4,
  "Jum'at": 5,
};

// Time range for the grid (07:00 - 17:00)
const START_HOUR = 7;
const END_HOUR = 17;
const TOTAL_MINUTES = (END_HOUR - START_HOUR) * 60;

// Subject-specific colors for visual distinction
const COLORS = [
  { bg: "bg-blue-100", border: "border-blue-300", text: "text-blue-800", dot: "bg-blue-500" },
  { bg: "bg-emerald-100", border: "border-emerald-300", text: "text-emerald-800", dot: "bg-emerald-500" },
  { bg: "bg-violet-100", border: "border-violet-300", text: "text-violet-800", dot: "bg-violet-500" },
  { bg: "bg-amber-100", border: "border-amber-300", text: "text-amber-800", dot: "bg-amber-500" },
  { bg: "bg-rose-100", border: "border-rose-300", text: "text-rose-800", dot: "bg-rose-500" },
  { bg: "bg-cyan-100", border: "border-cyan-300", text: "text-cyan-800", dot: "bg-cyan-500" },
  { bg: "bg-orange-100", border: "border-orange-300", text: "text-orange-800", dot: "bg-orange-500" },
  { bg: "bg-indigo-100", border: "border-indigo-300", text: "text-indigo-800", dot: "bg-indigo-500" },
  { bg: "bg-pink-100", border: "border-pink-300", text: "text-pink-800", dot: "bg-pink-500" },
  { bg: "bg-teal-100", border: "border-teal-300", text: "text-teal-800", dot: "bg-teal-500" },
  { bg: "bg-lime-100", border: "border-lime-300", text: "text-lime-800", dot: "bg-lime-500" },
  { bg: "bg-fuchsia-100", border: "border-fuchsia-300", text: "text-fuchsia-800", dot: "bg-fuchsia-500" },
];

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function getTimeSlots(): string[] {
  const slots: string[] = [];
  for (let h = START_HOUR; h < END_HOUR; h++) {
    slots.push(`${h.toString().padStart(2, "0")}:00`);
  }
  return slots;
}

export default function ScheduleGrid({ schedules }: ScheduleGridProps) {
  const timeSlots = getTimeSlots();

  // Build color map: each unique subject gets a consistent color
  const subjectNames = [...new Set(schedules.map((s) => s.subjectName))];
  const colorMap = new Map<string, (typeof COLORS)[number]>();
  subjectNames.forEach((name, i) => {
    colorMap.set(name, COLORS[i % COLORS.length]);
  });

  // Group schedules by day
  const byDay = new Map<string, CourseSchedule[]>();
  for (const day of DAYS) {
    byDay.set(day, []);
  }
  for (const s of schedules) {
    const list = byDay.get(s.hari);
    if (list) list.push(s);
  }

  return (
    <div className="space-y-6">

      {/* Actual positioned grid (desktop) */}
      <div className="hidden lg:block">
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="relative">
            {/* Header */}
            <div className="grid grid-cols-[80px_repeat(5,1fr)] bg-gray-50 border-b border-gray-200">
              <div className="p-3 border-r border-gray-200" />
              {DAYS.map((day) => (
                <div
                  key={day}
                  className="p-3 text-center border-r border-gray-200 last:border-r-0"
                >
                  <span className="text-sm font-semibold text-gray-700">
                    {day}
                  </span>
                </div>
              ))}
            </div>

            {/* Body: relative container for absolute positioned blocks */}
            <div className="relative" style={{ height: `${TOTAL_MINUTES}px` }}>
              {/* Time grid lines */}
              {timeSlots.map((slot, i) => (
                <div
                  key={slot}
                  className="absolute left-0 right-0 border-b border-gray-100 grid grid-cols-[80px_repeat(5,1fr)]"
                  style={{ top: `${i * 60}px`, height: "60px" }}
                >
                  <div className="border-r border-gray-100 flex items-start justify-end pr-3 pt-1">
                    <span className="text-xs text-gray-400 font-medium">
                      {slot}
                    </span>
                  </div>
                  {DAYS.map((day) => (
                    <div
                      key={`${day}-${slot}`}
                      className="border-r border-gray-100 last:border-r-0"
                    />
                  ))}
                </div>
              ))}

              {/* Course blocks */}
              {schedules.map((course) => {
                const dayIdx = DAY_NUMBERS[course.hari];
                if (dayIdx === undefined) return null;

                const startMin =
                  timeToMinutes(course.jamAwal) - START_HOUR * 60;
                const endMin =
                  timeToMinutes(course.jamAkhir) - START_HOUR * 60;
                const duration = endMin - startMin;
                const color = colorMap.get(course.subjectName) || COLORS[0];

                // Calculate column position
                // col 0 = time label (80px), cols 1-5 = days
                const colStart = dayIdx; // 1-5

                return (
                  <div
                    key={`${course.id}-${course.hari}`}
                    className={`absolute ${color.bg} ${color.border} border rounded-lg p-2 overflow-hidden cursor-default hover:shadow-md transition-shadow`}
                    style={{
                      top: `${startMin}px`,
                      height: `${duration}px`,
                      // Position within the grid: skip the 80px time column
                      // Each day column = (100% - 80px) / 5
                      left: `calc(80px + (100% - 80px) * ${(colStart - 1)} / 5 + 2px)`,
                      width: `calc((100% - 80px) / 5 - 4px)`,
                      pointerEvents: "auto",
                      zIndex: 10,
                    }}
                  >
                    <p
                      className={`text-xs font-semibold ${color.text} leading-tight truncate`}
                    >
                      {course.subjectName}
                    </p>
                    <p className="text-[10px] text-gray-600 mt-0.5 truncate">
                      {course.jamAwal} - {course.jamAkhir}
                    </p>
                    {course.ruang && (
                      <p className="text-[10px] text-gray-500 truncate">
                        {course.ruang}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Mobile: card list grouped by day */}
      <div className="lg:hidden space-y-4">
        {DAYS.map((day) => {
          const dayCourses = byDay.get(day) || [];
          // Sort by start time
          const sorted = [...dayCourses].sort((a, b) =>
            a.jamAwal.localeCompare(b.jamAwal)
          );

          return (
            <div key={day}>
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2 px-1">
                {day}
              </h3>
              {sorted.length === 0 ? (
                <div className="bg-gray-50 rounded-xl p-4 text-center text-sm text-gray-400">
                  No classes
                </div>
              ) : (
                <div className="space-y-2">
                  {sorted.map((course) => {
                    const color =
                      colorMap.get(course.subjectName) || COLORS[0];
                    return (
                      <div
                        key={`${course.id}-${course.hari}-mobile`}
                        className={`${color.bg} ${color.border} border rounded-xl p-4`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p
                              className={`font-semibold text-sm ${color.text}`}
                            >
                              {course.subjectName}
                            </p>
                            <p className="text-xs text-gray-600 mt-1">
                              {course.dosenTitle}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-xs font-medium text-gray-700">
                              {course.jamAwal} - {course.jamAkhir}
                            </p>
                            {course.ruang && (
                              <p className="text-xs text-gray-500 mt-0.5">
                                {course.ruang}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 mt-2 text-[11px] text-gray-500">
                          <span>{course.kodeKelas}</span>
                          <span>·</span>
                          <span>Kelas {course.pararel}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
          Subjects
        </h3>
        <div className="flex flex-wrap gap-2">
          {subjectNames.map((name) => {
            const color = colorMap.get(name) || COLORS[0];
            return (
              <div
                key={name}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full ${color.bg} ${color.text}`}
              >
                <div className={`w-2 h-2 rounded-full ${color.dot}`} />
                <span className="text-xs font-medium truncate max-w-[200px]">
                  {name}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
