export const legalCopy = {
  en: {
    "/privacy": [
      [
        "Who operates Blind Spot",
        "Blind Spot Interval is a spaced-review service operated by Abdulatif Abdunazirov. Blind Spot does not sell personal data or display advertising.",
      ],
      [
        "Google Sign-In and study data",
        "We use Google Sign-In through Firebase Authentication. We use your Firebase account identifier, Google-provided email address and display name to recognize your account. We store your learning topics, tags, notes and materials, review schedules and history, self-assessed ratings, memory estimates and study preferences to personalize scheduling and show progress.",
      ],
      [
        "Google Calendar",
        "Connecting Calendar is optional. We request permission to manage the dedicated calendar created by Blind Spot and to read free/busy times from your primary calendar to avoid conflicts. We use app-calendar events, event mappings and sync metadata to keep reviews in sync. Review event details can include topic titles, materials, tags, importance and a Blind Spot link. We store encrypted Google credentials to sync in the background. Google provides Calendar and handles data in your Google account under its own policies.",
      ],
      [
        "Connected AI applications",
        "You authorize each connected AI application and choose the permissions it receives. Authorized applications may receive learning topics, materials (including notes), ratings, review history, review times, study preferences and derived statistics through Blind Spot Connect, as permitted by your scopes. Approved write requests can create topics, complete reviews or reschedule pending reviews. Review schedule and sync results may reflect Calendar availability. Blind Spot Connect does not return Google tokens, personal Calendar event details or primary-calendar free/busy intervals to AI providers. Providers handle data they receive under their own policies. Disconnecting an application stops future authorized access. It does not remove information already shared with that provider.",
      ],
      [
        "Infrastructure and security",
        "We use Firebase and Google Cloud for authentication, hosting, Firestore storage, backend processing and operational logging. Technical records can include request timing and status, rate-limit counters, application identifiers and a hashed account identifier for Connect security events. We use these records to operate, secure and troubleshoot the service.",
      ],
      [
        "Retention and account deletion",
        "We keep active account and study data to provide the service. Temporary OAuth records, pending actions and technical counters have separate expiration and cleanup rules. When you request account deletion, access is blocked and cleanup removes your Firebase account and study data, invalidates Connect access and revokes Calendar credentials still held by Blind Spot where supported. Existing Google Calendar events may remain. Manage them in Google Calendar. Previously shared copies remain subject to the receiving provider’s controls. A minimal hashed deletion record prevents stale requests from recreating your old account. Backups and operational logs are handled separately from live account data.",
      ],
      [
        "Your choices and requests",
        "Use Settings to manage integrations and request account deletion. Email the publisher to request access, correction or deletion of personal data, or to ask about your privacy rights. Include the email associated with your account so we can identify it. We may need to verify your identity.",
      ],
    ],
    "/terms": [
      [
        "The service",
        "Blind Spot Interval helps you organize learning materials, schedule spaced reviews and track self-assessed recall. Abdulatif Abdunazirov operates the service. The Blind Spot ChatGPT plugin is free. Third-party services may have their own access requirements and charges.",
      ],
      [
        "Your account and content",
        "Keep your Google account secure and use only an account you are authorized to use. You retain ownership of the educational content you add. By providing it, you allow Blind Spot to process it to operate the service and share it with integrations you authorize. Only upload or share material you have the right to use.",
      ],
      [
        "Acceptable use",
        "Use the service lawfully. Do not interfere with service operation, evade security controls, access another person’s data without authorization, or upload unlawful or harmful material.",
      ],
      [
        "Recommendations and integrations",
        "Review times, memory estimates and AI-generated recommendations are learning aids. Ratings are self-assessments, and recommendations can be incomplete or inaccurate. Check suggested actions and information before relying on them. Google Calendar and connected AI applications are optional and are governed by their respective providers’ terms and privacy policies.",
      ],
      [
        "Availability and account restrictions",
        "Features and availability may change. Service may be interrupted for maintenance, provider changes or security issues. We may restrict or suspend access for abuse, security concerns or violations of these terms. You can stop using the service and request account deletion in Settings. The current terms are available on this page.",
      ],
    ],
    "/support": [
      [
        "Google Sign-In",
        "Choose Continue with Google and select the Google account you used previously. If the window fails to open, allow pop-ups and site storage for Blind Spot and try again. If it still fails, email support with the error text and browser version.",
      ],
      [
        "Topics and review schedules",
        "Open Topics to add a topic with study materials and optional ratings. Open Today to see due reviews or Calendar to inspect the schedule. Complete a review by choosing your own recall rating. To move a pending review, open it from Calendar and choose a new time.",
      ],
      [
        "Google Calendar sync",
        "In Settings → Google Calendar, choose Connect and grant the requested permissions. Look for the dedicated Blind Spot Interval calendar in Google Calendar. Use Resync if a review is missing or the app reports a sync error. Disconnect stops sync. You can separately remove Google access in your Google Account and manage existing events in Google Calendar.",
      ],
      [
        "Connect ChatGPT, Claude or Gemini",
        "In Settings → Blind Spot Connect choose your assistant and open its setup instructions. In ChatGPT use the custom MCP server setup in Plugins (called Apps in some workspaces). In Claude open Customize → Connectors and add a custom connector. In Gemini on the web use Gemini Apps Developer Mode to create and test a custom app. Availability depends on your provider account, workspace and the configured connection. Use the server address shown in Settings, sign in to Blind Spot and review the requested permissions.",
      ],
      [
        "Manage and disconnect AI applications",
        "In Settings → Blind Spot Connect, review each connected app and its permissions. To change the scope, disconnect the app and authorize it again with the permissions you want. You can disconnect one app or all apps. When a write requires confirmation, check the action details in Blind Spot before approving or declining.",
      ],
      [
        "Delete your account or make a privacy request",
        "Go to Settings → Account → Delete account, read the explanation and confirm with Google. The request starts background cleanup and blocks access to the account. Google Calendar events and copies previously received by AI providers are managed with those providers. For privacy requests or help with deletion, email support.",
      ],
      [
        "Report bugs or suggest features",
        "Email support with the steps you took, what you expected and what happened. For a feature suggestion, describe the task you want to do. Share only sanitized screenshots and error messages. Never send passwords, OAuth tokens or other confidential credentials.",
      ],
    ],
  },
  ru: {
    "/privacy": [
      [
        "Кто управляет сервисом",
        "Blind Spot Interval — сервис интервального повторения, которым управляет Абдулатиф Абдуназиров. Blind Spot не продаёт персональные данные и не показывает рекламу.",
      ],
      [
        "Вход через Google и учебные данные",
        "Для входа через Google используется Firebase Authentication. Идентификатор Firebase, адрес электронной почты и имя из Google помогают распознать ваш аккаунт. Мы храним темы, теги, заметки и материалы, расписание и историю повторений, самооценки, оценки состояния памяти и настройки обучения для составления расписания и отслеживания прогресса.",
      ],
      [
        "Google Календарь",
        "Подключение необязательно. Мы запрашиваем разрешение управлять отдельным календарём, созданным Blind Spot, и читать интервалы занятости в основном календаре, чтобы избежать пересечений. Для синхронизации мы используем события календаря приложения, связи с событиями и сведения о синхронизации. События повторений могут содержать названия тем, материалы, теги, важность и ссылку на Blind Spot. Учётные данные Google хранятся в зашифрованном виде для фоновой синхронизации. Google предоставляет Календарь и обрабатывает данные в вашем аккаунте по своим правилам.",
      ],
      [
        "Подключённые ИИ-приложения",
        "Вы разрешаете доступ каждому приложению и выбираете его права. В рамках этих прав через Blind Spot Connect приложение может получать темы, материалы (в том числе заметки), оценки, историю и время повторений, учебные настройки и статистику. Одобренные действия могут создавать темы, завершать или переносить предстоящие повторения. Расписание и результаты синхронизации могут зависеть от занятости в Календаре. Blind Spot Connect не передаёт ИИ-провайдерам токены Google, сведения о личных событиях или интервалы занятости основного календаря. Провайдеры обрабатывают полученные сведения по своим правилам. Отключение закрывает будущий доступ, а ранее переданные сведения остаются у провайдера.",
      ],
      [
        "Инфраструктура и безопасность",
        "Мы используем Firebase и Google Cloud для входа, размещения сайта, хранения в Firestore, серверной обработки и журналирования. Технические записи могут включать время и статус запросов, счётчики ограничений, идентификаторы приложений и хеш идентификатора аккаунта для событий безопасности Connect. Эти записи нужны для работы, защиты и диагностики сервиса.",
      ],
      [
        "Хранение данных и удаление аккаунта",
        "Мы храним данные действующего аккаунта и учебные данные для работы сервиса. Временные записи OAuth, ожидающие действия и технические счётчики имеют отдельные правила истечения срока и очистки. После запроса на удаление доступ блокируется. Очистка удаляет аккаунт Firebase и учебные данные, отзывает доступ Connect и, где возможно, сохранённые в Blind Spot учётные данные Календаря. Существующие события могут остаться в Google Календаре, где ими можно управлять. Копиями ранее переданных данных управляет их получатель. Минимальная запись с хешем идентификатора не даёт устаревшим запросам восстановить прежний аккаунт. Резервные копии и технические журналы обрабатываются отдельно от активных данных аккаунта.",
      ],
      [
        "Ваши права и запросы",
        "В настройках можно управлять интеграциями и запросить удаление аккаунта. Чтобы запросить доступ к данным, их исправление или удаление либо уточнить свои права, напишите издателю. Укажите адрес аккаунта, чтобы мы могли его найти. Может потребоваться подтверждение личности.",
      ],
    ],
    "/terms": [
      [
        "О сервисе",
        "Blind Spot Interval помогает организовать учебные материалы, планировать интервальные повторения и отслеживать самооценку знаний. Сервисом управляет Абдулатиф Абдуназиров. Плагин Blind Spot для ChatGPT бесплатен. У сторонних сервисов могут действовать собственные условия доступа и тарифы.",
      ],
      [
        "Аккаунт и материалы",
        "Защищайте свой аккаунт Google и используйте только аккаунт, к которому у вас есть разрешённый доступ. Вы сохраняете права на добавленные учебные материалы. Добавляя их, вы разрешаете Blind Spot обрабатывать их для работы сервиса и передавать их интеграциям, которым вы дали доступ. Добавляйте и передавайте только материалы, которые вы вправе использовать.",
      ],
      [
        "Правила использования",
        "Пользуйтесь сервисом законно. Запрещено мешать работе сервиса, обходить средства защиты, получать доступ к чужим данным без разрешения и загружать незаконные или вредоносные материалы.",
      ],
      [
        "Рекомендации и интеграции",
        "Расписание, оценки памяти и рекомендации ИИ помогают в обучении. Оценки знаний субъективны, а рекомендации могут быть неполными или ошибочными. Проверяйте предложенные действия и сведения, прежде чем полагаться на них. Подключение Google Календаря и ИИ-приложений необязательно. На них распространяются условия и правила конфиденциальности соответствующих провайдеров.",
      ],
      [
        "Доступность и ограничения аккаунта",
        "Функции и доступность могут меняться. Работа сервиса может прерываться из-за обслуживания, изменений у провайдеров или по соображениям безопасности. Доступ может быть ограничен или приостановлен при злоупотреблении, угрозе безопасности или нарушении условий. Вы можете прекратить пользоваться сервисом и запросить удаление аккаунта в настройках. Действующие условия доступны на этой странице.",
      ],
    ],
    "/support": [
      [
        "Вход через Google",
        "Нажмите кнопку входа через Google и выберите прежний аккаунт. Если окно не открывается, разрешите всплывающие окна и хранение данных сайта для Blind Spot и повторите попытку. Если проблема сохраняется, отправьте текст ошибки и версию браузера в поддержку.",
      ],
      [
        "Темы и расписание повторений",
        "В разделе «Темы» добавьте тему с материалами и, при желании, оценками. В разделе «Сегодня» показаны текущие повторения, а в разделе «Календарь» — расписание. Чтобы завершить повторение, оцените, насколько хорошо вы помните материал. Чтобы перенести предстоящее повторение, откройте его в календаре и выберите новое время.",
      ],
      [
        "Синхронизация с Google Календарём",
        "В настройках Google Календаря выберите подключение и предоставьте запрошенные разрешения. Найдите отдельный календарь Blind Spot Interval в Google Календаре. Если повторение пропало или возникла ошибка, запустите повторную синхронизацию. Отключение останавливает синхронизацию. Доступ Google можно отдельно отозвать в аккаунте Google, а существующими событиями управлять в Google Календаре.",
      ],
      [
        "Подключение ChatGPT, Claude и Gemini",
        "В настройках Blind Spot Connect выберите помощника и откройте инструкцию. В ChatGPT используйте подключение собственного MCP-сервера в разделе Plugins (в некоторых рабочих пространствах — Apps). В Claude откройте Customize → Connectors и добавьте свой коннектор. В веб-версии Gemini используйте Gemini Apps Developer Mode для создания и проверки приложения. Доступность зависит от аккаунта, рабочего пространства и настроек подключения. Используйте адрес из настроек Blind Spot, войдите и проверьте запрошенные разрешения.",
      ],
      [
        "Управление доступом ИИ-приложений",
        "В настройках Blind Spot Connect проверьте подключённые приложения и их права. Для изменения прав отключите приложение и подключите его снова с нужными разрешениями. Можно отключить одно или все приложения. Если изменение требует подтверждения, проверьте его детали в Blind Spot перед одобрением или отклонением.",
      ],
      [
        "Удаление аккаунта и запросы о данных",
        "Откройте «Настройки → Аккаунт → Удалить аккаунт», прочитайте пояснение и подтвердите действие через Google. Запрос блокирует доступ и запускает фоновую очистку. События Google Календаря и ранее переданные ИИ-провайдерам копии управляются у соответствующих провайдеров. По вопросам удаления и обработки данных напишите в поддержку.",
      ],
      [
        "Ошибки и предложения",
        "Напишите в поддержку, какие действия вы выполнили, чего ожидали и что произошло. Если вы предлагаете новую функцию, опишите задачу, которую хотите решить. Присылайте только скриншоты и сообщения без личных данных. Никогда не отправляйте пароли, токены OAuth или другие конфиденциальные учётные данные.",
      ],
    ],
  },
} as const;
