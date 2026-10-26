CREATE TABLE IF NOT EXISTS groups (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  name           VARCHAR(191) NOT NULL UNIQUE,
  semester_start VARCHAR(10) NOT NULL,
  course         INT DEFAULT NULL,
  semester       INT DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  login         VARCHAR(191) COLLATE utf8mb4_unicode_ci NOT NULL UNIQUE,
  name          VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  group_id      INT NOT NULL,
  role          ENUM('student', 'starosta') NOT NULL DEFAULT 'student',
  approved      TINYINT(1) NOT NULL DEFAULT 1,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (group_id) REFERENCES groups(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sessions (
  token      VARCHAR(128) PRIMARY KEY,
  user_id    INT NOT NULL,
  expires_at BIGINT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS lessons (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  group_id   INT NOT NULL,
  day        INT NOT NULL,
  week       INT NOT NULL,
  start_time VARCHAR(5) NOT NULL,
  end_time   VARCHAR(5) NOT NULL,
  subject    VARCHAR(255) NOT NULL,
  type       VARCHAR(50) NOT NULL,
  room       VARCHAR(255) NOT NULL,
  teacher    VARCHAR(255) NOT NULL DEFAULT '',
  INDEX lessons_group_day (group_id, day),
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tasks (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT NOT NULL,
  group_id   INT DEFAULT NULL,
  date       VARCHAR(10) NOT NULL,
  text       TEXT NOT NULL,
  subject    VARCHAR(255),
  done       TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX tasks_user_date (user_id, date),
  INDEX tasks_group_date (group_id, date),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS task_completions (
  task_id INT NOT NULL,
  user_id INT NOT NULL,
  done    TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (task_id, user_id),
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
