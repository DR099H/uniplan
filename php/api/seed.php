<?php
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/week.php';

/**
 * Ensures database schema is created and initial seed data is loaded if groups table is empty.
 * Returns true if seed data was inserted, false if data already existed.
 */
function ensureDatabaseSeeded(PDO $db) {
    try {
        $stmt = $db->query('SELECT COUNT(*) FROM groups');
        $count = (int)$stmt->fetchColumn();
        if ($count > 0) {
            return false;
        }
    } catch (Exception $e) {
        // Table `groups` does not exist yet — create schema
        $schemaFile = __DIR__ . '/../sql/schema.sql';
        if (file_exists($schemaFile)) {
            $schema = file_get_contents($schemaFile);
            $statements = array_filter(array_map('trim', explode(';', $schema)));
            foreach ($statements as $sql) {
                if ($sql !== '') {
                    $db->exec($sql);
                }
            }
        }
        $stmt = $db->query('SELECT COUNT(*) FROM groups');
        if ((int)$stmt->fetchColumn() > 0) {
            return false;
        }
    }

    $db->beginTransaction();
    try {
        $SEMESTER_START = '2026-09-01';
        $GROUPS = ['24ИП3б', '25ИВТ1б', '25ИП1б', '25ИП2б', '25ИП3б'];

        $insGroup = $db->prepare('INSERT INTO groups (name, semester_start) VALUES (?, ?)');
        $groupId = [];
        foreach ($GROUPS as $name) {
            $insGroup->execute([$name, $SEMESTER_START]);
            $groupId[$name] = (int)$db->lastInsertId();
        }

        $insLesson = $db->prepare('INSERT INTO lessons (group_id, day, week, start_time, end_time, subject, type, room, teacher) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');

        $P = [
            1 => ['08:00', '09:30'],
            2 => ['09:45', '11:15'],
            3 => ['11:30', '13:00'],
            4 => ['13:40', '15:10'],
            5 => ['15:25', '16:55'],
            6 => ['17:10', '18:40'],
        ];

        $TKRPO = 'Технологии командной разработки ПО';
        $BD = 'Базы данных';
        $OOP = 'Объектно-ориентированное программирование';
        $TV = 'Теория вероятностей и мат. статистика';
        $NET = 'Компьютерные сети';
        $OS = 'Операционные системы';
        $WEB = 'Web-программирование';
        $ENG = 'Иностранный язык';
        $PE = 'Физическая культура';
        $PHIL = 'Философия';

        $SCHEDULE_25IP3B = [
            [1, 0, 1, $TV, 'лекция', '1-201', 'Мельникова Т.С.'],
            [1, 0, 2, $OOP, 'лекция', '7-305', 'Фролов А.И.'],
            [1, 1, 3, $OOP, 'лабораторная', '7-412', 'Фролов А.И.'],
            [1, 2, 3, $TV, 'практика', '1-118', 'Мельникова Т.С.'],
            [2, 0, 2, $TKRPO, 'лекция', '7-210', 'Орлова Н.Ю.'],
            [2, 1, 3, $TKRPO, 'лабораторная', '7-414', 'Орлова Н.Ю.'],
            [2, 2, 3, $BD, 'лабораторная', '7-416', 'Зайцев К.В.'],
            [2, 0, 4, $ENG, 'практика', '3-108', 'Королёва Е.П.'],
            [3, 0, 1, $BD, 'лекция', '7-305', 'Зайцев К.В.'],
            [3, 0, 2, $NET, 'лекция', '7-201', 'Савин Д.М.'],
            [3, 2, 3, $NET, 'лабораторная', '7-418', 'Савин Д.М.'],
            [3, 0, 5, $PE, 'практика', 'Спортзал', ''],
            [4, 1, 2, $OS, 'лекция', '7-210', 'Громов П.Д.'],
            [4, 1, 3, $OS, 'лабораторная', '7-412', 'Громов П.Д.'],
            [4, 2, 3, $WEB, 'лабораторная', '7-414', 'Белов С.Н.'],
            [4, 2, 4, $WEB, 'лабораторная', '7-414', 'Белов С.Н.'],
            [4, 1, 4, $ENG, 'практика', '3-108', 'Королёва Е.П.'],
            [5, 0, 2, $WEB, 'лекция', '7-305', 'Белов С.Н.'],
            [5, 1, 3, $TV, 'практика', '1-118', 'Мельникова Т.С.'],
            [5, 2, 3, $PE, 'практика', 'Спортзал', ''],
            [5, 0, 4, $PHIL, 'семинар', '2-301', 'Лебедева О.Р.'],
            [6, 1, 1, $PHIL, 'лекция', '2-101', 'Лебедева О.Р.'],
            [6, 1, 2, $ENG, 'практика', '3-108', 'Королёва Е.П.'],
        ];

        $SCHEDULE_25IP1B = [
            [1, 0, 2, 'Математический анализ', 'лекция', '1-201', 'Ершов В.Л.'],
            [1, 0, 3, 'Программирование на C++', 'лабораторная', '7-410', 'Никитина А.А.'],
            [2, 1, 1, 'Дискретная математика', 'лекция', '1-120', 'Ершов В.Л.'],
            [2, 2, 1, 'Дискретная математика', 'практика', '1-118', 'Ершов В.Л.'],
            [3, 0, 2, 'История России', 'семинар', '2-204', 'Павлова И.Г.'],
            [4, 0, 3, 'Программирование на C++', 'лекция', '7-305', 'Никитина А.А.'],
            [5, 0, 1, $ENG, 'практика', '3-110', 'Королёва Е.П.'],
        ];

        $addSchedule = function($groupName, $rows) use ($insLesson, $groupId, $P) {
            foreach ($rows as $row) {
                $day = $row[0];
                $week = $row[1];
                $pair = $row[2];
                $subject = $row[3];
                $type = $row[4];
                $room = $row[5];
                $teacher = $row[6];
                $insLesson->execute([$groupId[$groupName], $day, $week, $P[$pair][0], $P[$pair][1], $subject, $type, $room, $teacher]);
            }
        };

        $addSchedule('25ИП3б', $SCHEDULE_25IP3B);
        $addSchedule('25ИП1б', $SCHEDULE_25IP1B);

        $DEMO_PASSWORD = 'uniplan2026';
        $DEMO_USERS = [
            ['login' => 'student', 'name' => 'Дмитрий Лебедев', 'group' => '25ИП3б', 'role' => 'student'],
            ['login' => 'starosta', 'name' => 'Ольга Миронова', 'group' => '25ИП3б', 'role' => 'starosta'],
            ['login' => 'starosta1', 'name' => 'Кирилл Афанасьев', 'group' => '25ИП1б', 'role' => 'starosta'],
        ];

        $insUser = $db->prepare('INSERT INTO users (login, name, password_hash, group_id, role, approved) VALUES (?, ?, ?, ?, ?, 1)');
        $userId = [];
        $passwordHash = hashPassword($DEMO_PASSWORD);

        foreach ($DEMO_USERS as $u) {
            $insUser->execute([$u['login'], $u['name'], $passwordHash, $groupId[$u['group']], $u['role']]);
            $userId[$u['login']] = (int)$db->lastInsertId();
        }

        $today = todayISO();
        $insTask = $db->prepare('INSERT INTO tasks (user_id, date, text, subject, done) VALUES (?, ?, ?, ?, ?)');

        $tasks = [
            [-1, 'Дочитать конспект по ТВиМС', $TV, 0],
            [0, 'Оформить отчёт по лабе №2', $NET, 0],
            [0, 'Взять справку для физкультуры', $PE, 1],
            [0, 'Скинуть старосте фото конспекта', null, 0],
            [1, 'Защитить лабу №3 (ветки и Pull Request)', $TKRPO, 0],
            [1, 'Повторить нормальные формы', $BD, 0],
            [3, 'Тест по английскому: Unit 4', $ENG, 0],
            [6, 'Подготовить вопросы к семинару', $PHIL, 0],
        ];

        foreach ($tasks as $task) {
            $date = addDays($today, $task[0]);
            $insTask->execute([$userId['student'], $date, $task[1], $task[2], $task[3]]);
        }

        $db->commit();
        return true;
    } catch (Exception $e) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        throw $e;
    }
}
