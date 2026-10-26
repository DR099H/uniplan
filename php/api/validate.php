<?php
require_once __DIR__ . '/week.php';

const LESSON_TYPES = ['лекция', 'практика', 'лабораторная', 'семинар', 'другое'];
const DAY_SHORT = [1 => 'Пн', 2 => 'Вт', 3 => 'Ср', 4 => 'Чт', 5 => 'Пт', 6 => 'Сб', 7 => 'Вс'];
const MAX_IMPORT_LESSONS = 300;

const DAY_ALIASES = [
    'пн' => 1, 'понедельник' => 1, 'mon' => 1, 'monday' => 1,
    'вт' => 2, 'вторник' => 2, 'tue' => 2, 'tuesday' => 2,
    'ср' => 3, 'среда' => 3, 'wed' => 3, 'wednesday' => 3,
    'чт' => 4, 'четверг' => 4, 'thu' => 4, 'thursday' => 4,
    'пт' => 5, 'пятница' => 5, 'fri' => 5, 'friday' => 5,
    'сб' => 6, 'суббота' => 6, 'sat' => 6, 'saturday' => 6,
    'вс' => 7, 'воскресенье' => 7, 'sun' => 7, 'sunday' => 7,
];

const WEEK_ALIASES = [
    '0' => 0, 'обе' => 0, 'каждая' => 0, 'все' => 0, 'both' => 0, 'all' => 0,
    '1' => 1, 'i' => 1, 'первая' => 1, 'нечетная' => 1, 'нечётная' => 1,
    '2' => 2, 'ii' => 2, 'вторая' => 2, 'четная' => 2, 'чётная' => 2,
];

const TYPE_ALIASES = [
    'лекция' => 'лекция', 'лек' => 'лекция', 'лк' => 'лекция', 'lecture' => 'лекция',
    'практика' => 'практика', 'практ' => 'практика', 'пр' => 'практика', 'практическое занятие' => 'практика', 'practice' => 'практика',
    'лабораторная' => 'лабораторная', 'лаба' => 'лабораторная', 'лаб' => 'лабораторная', 'лр' => 'лабораторная',
    'лабораторная работа' => 'лабораторная', 'lab' => 'лабораторная',
    'семинар' => 'семинар', 'сем' => 'семинар', 'seminar' => 'семинар',
    'другое' => 'другое', 'other' => 'другое',
];

function normTime($value) {
    $str = trim((string)($value !== null ? $value : ''));
    if (!preg_match('/^(\d{1,2}):(\d{2})$/', $str, $m)) return null;
    $h = (int)$m[1];
    $min = (int)$m[2];
    if ($h > 23 || $min > 59) return null;
    return sprintf('%02d:%02d', $h, $min);
}

function normText($value) {
    if (!is_string($value)) return '';
    return trim(preg_replace('/\s+/', ' ', $value));
}

function normalizeLesson($raw, $prefix = '') {
    $errors = [];
    $err = function($field, $message) use (&$errors, $prefix) {
        $errors[] = ['path' => $prefix ? "{$prefix}.{$field}" : $field, 'message' => $message];
    };

    if (!$raw || !is_array($raw) || isset($raw[0])) {
        return ['lesson' => null, 'errors' => [['path' => $prefix ? $prefix : 'lesson', 'message' => 'Ожидается объект с описанием пары']]];
    }

    $day = null;
    if (isset($raw['day'])) {
        if (is_int($raw['day']) && $raw['day'] >= 1 && $raw['day'] <= 7) {
            $day = $raw['day'];
        } elseif (is_string($raw['day'])) {
            $key = preg_replace('/\.$/', '', mb_strtolower(trim($raw['day']), 'UTF-8'));
            $day = isset(DAY_ALIASES[$key]) ? DAY_ALIASES[$key] : null;
        }
    }
    if ($day === null) {
        $err('day', 'Укажите день недели: число 1–7 или название (Пн, Вт, …)');
    }

    $week = null;
    if (!isset($raw['week']) || $raw['week'] === '') {
        $week = 0;
    } else {
        $key = mb_strtolower(trim((string)$raw['week']), 'UTF-8');
        $week = isset(WEEK_ALIASES[$key]) ? WEEK_ALIASES[$key] : null;
    }
    if ($week === null) {
        $err('week', 'Неделя должна быть 1, 2 или «обе»');
    }

    $start = normTime(isset($raw['start']) ? $raw['start'] : null);
    $end = normTime(isset($raw['end']) ? $raw['end'] : null);
    
    if (!$start) $err('start', 'Время начала в формате ЧЧ:ММ, например 08:00');
    if (!$end) $err('end', 'Время окончания в формате ЧЧ:ММ, например 09:30');
    
    if ($start && $end && timeToMinutes($end) <= timeToMinutes($start)) {
        $err('end', 'Пара должна заканчиваться позже, чем начинается');
    }

    $subject = normText(isset($raw['subject']) ? $raw['subject'] : '');
    if (!$subject) {
        $err('subject', 'Укажите название предмета');
    } elseif (mb_strlen($subject, 'UTF-8') > 120) {
        $err('subject', 'Название предмета длиннее 120 символов');
    }

    $type = 'другое';
    if (isset($raw['type']) && $raw['type'] !== '') {
        $key = mb_strtolower(normText($raw['type']), 'UTF-8');
        $type = isset(TYPE_ALIASES[$key]) ? TYPE_ALIASES[$key] : null;
        if ($type === null) {
            $err('type', 'Тип занятия: ' . implode(', ', LESSON_TYPES));
        }
    }

    $room = normText(isset($raw['room']) ? $raw['room'] : '');
    if (!$room) {
        $err('room', 'Укажите аудиторию');
    } elseif (mb_strlen($room, 'UTF-8') > 40) {
        $err('room', 'Аудитория длиннее 40 символов');
    }

    $teacher = normText(isset($raw['teacher']) ? $raw['teacher'] : '');
    if (mb_strlen($teacher, 'UTF-8') > 80) {
        $err('teacher', 'Имя преподавателя длиннее 80 символов');
    }

    if (!empty($errors)) {
        return ['lesson' => null, 'errors' => $errors];
    }

    return [
        'lesson' => [
            'day' => $day,
            'week' => $week,
            'start' => $start,
            'end' => $end,
            'subject' => $subject,
            'type' => $type,
            'room' => $room,
            'teacher' => $teacher
        ],
        'errors' => $errors
    ];
}

function lessonsOverlap(array $a, array $b) {
    if ((int)$a['day'] !== (int)$b['day']) return false;
    if ((int)$a['week'] !== 0 && (int)$b['week'] !== 0 && (int)$a['week'] !== (int)$b['week']) return false;
    return timeToMinutes($a['start']) < timeToMinutes($b['end']) && timeToMinutes($b['start']) < timeToMinutes($a['end']);
}

function describeLesson(array $l) {
    $weekStr = (int)$l['week'] === 0 ? 'обе недели' : "{$l['week']}-я неделя";
    $dayStr = isset(DAY_SHORT[$l['day']]) ? DAY_SHORT[$l['day']] : '';
    return "{$dayStr} {$l['start']}–{$l['end']}, {$weekStr}: {$l['subject']}";
}

function validateSchedule($data, array $options = []) {
    $groupName = isset($options['groupName']) ? $options['groupName'] : null;
    $existing = isset($options['existing']) ? $options['existing'] : [];
    
    $errors = [];
    
    if (is_array($data) && isset($data[0])) {
        $data = ['lessons' => $data];
    }
    
    if (!is_array($data)) {
        return ['ok' => false, 'errors' => [['path' => '', 'message' => 'Файл должен содержать объект с полем "lessons"']]];
    }

    if (isset($data['group']) && $groupName && mb_strtolower(normText($data['group']), 'UTF-8') !== mb_strtolower($groupName, 'UTF-8')) {
        $errors[] = ['path' => 'group', 'message' => "Файл для группы «" . normText($data['group']) . "», а вы староста группы «{$groupName}»"];
    }

    $semesterStart = null;
    if (isset($data['semesterStart'])) {
        if (isValidISODate((string)$data['semesterStart'])) {
            $semesterStart = (string)$data['semesterStart'];
        } else {
            $errors[] = ['path' => 'semesterStart', 'message' => 'Дата начала семестра в формате ГГГГ-ММ-ДД'];
        }
    }

    if (!isset($data['lessons']) || !is_array($data['lessons']) || (!empty($data['lessons']) && !isset($data['lessons'][0]) && count(array_filter(array_keys($data['lessons']), 'is_string')) > 0)) {
        $errors[] = ['path' => 'lessons', 'message' => 'Поле "lessons" должно быть массивом пар'];
        return ['ok' => false, 'errors' => $errors];
    }
    
    $dataLessons = array_values($data['lessons']);
    
    if (count($dataLessons) === 0) {
        $errors[] = ['path' => 'lessons', 'message' => 'В файле нет ни одной пары'];
    }
    if (count($dataLessons) > MAX_IMPORT_LESSONS) {
        $errors[] = ['path' => 'lessons', 'message' => "Слишком много пар: " . count($dataLessons) . " (максимум " . MAX_IMPORT_LESSONS . ")"];
        return ['ok' => false, 'errors' => $errors];
    }

    $lessons = [];
    foreach ($dataLessons as $i => $raw) {
        $path = "lessons[{$i}]";
        $res = normalizeLesson($raw, $path);
        
        if (!$res['lesson']) {
            $errors = array_merge($errors, $res['errors']);
            continue;
        }
        
        $clashFileIndex = -1;
        foreach ($lessons as $idx => $l) {
            if (lessonsOverlap($l, $res['lesson'])) {
                $clashFileIndex = $idx;
                break;
            }
        }
        
        if ($clashFileIndex >= 0) {
            $clashLesson = $lessons[$clashFileIndex];
            $origIndex = $clashLesson['index'];
            $errors[] = ['path' => $path, 'message' => "Пересекается с lessons[{$origIndex}] (" . describeLesson($clashLesson) . ")"];
        }
        
        $clashDb = null;
        foreach ($existing as $l) {
            if (lessonsOverlap($l, $res['lesson'])) {
                $clashDb = $l;
                break;
            }
        }
        
        if ($clashDb) {
            $errors[] = ['path' => $path, 'message' => "Пересекается с парой из текущего расписания (" . describeLesson($clashDb) . ")"];
        }
        
        $lessons[] = array_merge($res['lesson'], ['index' => $i]);
    }

    if (!empty($errors)) {
        return ['ok' => false, 'errors' => $errors];
    }
    
    $finalLessons = array_map(function($l) {
        unset($l['index']);
        return $l;
    }, $lessons);

    return ['ok' => true, 'errors' => $errors, 'semesterStart' => $semesterStart, 'lessons' => $finalLessons];
}

function summarize(array $lessons) {
    $days = [];
    foreach ($lessons as $l) {
        $dayShort = isset(DAY_SHORT[$l['day']]) ? DAY_SHORT[$l['day']] : '';
        if ($dayShort) {
            $days[$dayShort] = (isset($days[$dayShort]) ? $days[$dayShort] : 0) + 1;
        }
    }
    
    return [
        'total' => count($lessons),
        'everyWeek' => count(array_filter($lessons, function($l) { return (int)$l['week'] === 0; })),
        'week1' => count(array_filter($lessons, function($l) { return (int)$l['week'] === 1; })),
        'week2' => count(array_filter($lessons, function($l) { return (int)$l['week'] === 2; })),
        'days' => $days,
    ];
}
