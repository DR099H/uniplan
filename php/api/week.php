<?php

function isValidISODate($value) {
    if (!is_string($value)) return false;
    if (!preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $value, $m)) return false;
    return checkdate((int)$m[2], (int)$m[3], (int)$m[1]);
}

function parseISO($iso) {
    return new DateTime($iso, new DateTimeZone('UTC'));
}

function toISO(DateTime $date) {
    return $date->format('Y-m-d');
}

function addDays($iso, $n) {
    $n = (int)$n;
    $d = parseISO($iso);
    $d->modify(($n >= 0 ? '+' : '') . $n . ' days');
    return toISO($d);
}

function dayOfWeek($iso) {
    $d = parseISO($iso);
    $w = (int)$d->format('w');
    return $w === 0 ? 7 : $w;
}

function mondayOf($iso) {
    return addDays($iso, 1 - dayOfWeek($iso));
}

function weekType($dateIso, $semesterStartIso) {
    $mondayDate = parseISO(mondayOf($dateIso));
    $mondayStart = parseISO(mondayOf($semesterStartIso));
    
    $diff = (int)round(($mondayDate->getTimestamp() - $mondayStart->getTimestamp()) / (7 * 24 * 60 * 60));
    return ((($diff % 2) + 2) % 2) === 0 ? 1 : 2;
}

function todayISO() {
    return (new DateTime())->format('Y-m-d');
}

function timeToMinutes($hhmm) {
    $parts = explode(':', (string)$hhmm);
    return (int)$parts[0] * 60 + (int)(isset($parts[1]) ? $parts[1] : 0);
}

function computeCourseAndSemester($groupName, $dateIso = null, $explicitCourse = null, $explicitSemester = null) {
    if ($explicitCourse && $explicitSemester) {
        return ['course' => (int)$explicitCourse, 'semester' => (int)$explicitSemester];
    }
    if (!preg_match('/^(\d{2})/', (string)$groupName, $match)) {
        return [
            'course' => $explicitCourse ? (int)$explicitCourse : 1,
            'semester' => $explicitSemester ? (int)$explicitSemester : 1
        ];
    }
    $admissionYear = 2000 + (int)$match[1];
    $date = $dateIso ? $dateIso : todayISO();
    $parts = explode('-', $date);
    $curYear = (int)$parts[0];
    $curMonth = (int)$parts[1];
    $academicYearDiff = $curYear - $admissionYear;
    $isSpring = $curMonth < 9;

    $course = $isSpring ? $academicYearDiff : $academicYearDiff + 1;
    if ($course < 1) $course = 1;
    $semester = $isSpring ? $course * 2 : $course * 2 - 1;
    if ($semester < 1) $semester = 1;

    return [
        'course' => $explicitCourse ? (int)$explicitCourse : $course,
        'semester' => $explicitSemester ? (int)$explicitSemester : $semester
    ];
}
