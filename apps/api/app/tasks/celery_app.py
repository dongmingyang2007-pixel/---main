from celery import Celery

from app.core.config import settings


celery_app = Celery("qihang", broker=settings.redis_url)
celery_app.conf.task_routes = {
    "app.tasks.worker_tasks.process_data_item": {"queue": "data"},
    "app.tasks.worker_tasks.run_training_job": {"queue": "train"},
    "app.tasks.worker_tasks.cleanup_deleted_dataset": {"queue": "cleanup"},
    "app.tasks.worker_tasks.cleanup_deleted_project": {"queue": "cleanup"},
    "app.tasks.worker_tasks.index_data_item": {"queue": "data"},
    "app.tasks.worker_tasks.extract_memories": {"queue": "inference"},
}
celery_app.conf.update(
    accept_content=["json"],
    task_serializer="json",
    result_serializer="json",
    event_serializer="json",
    task_ignore_result=True,
    broker_connection_retry_on_startup=True,
    task_send_sent_event=False,
    worker_send_task_events=False,
)
