import { DonationSettingsModule } from './donation-settings/donation-settings.module';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { CafesModule } from './cafes/cafes.module';
import { AuthModule } from './auth/auth.module';
import { SavedModule } from './saved/saved.module';
import { SubmissionsModule } from './submissions/submissions.module';
import { AdminModule } from './admin/admin.module';
import { StorageModule } from './storage/storage.module';
import { BlogsModule } from './blogs/blogs.module';
import { VisitedModule } from './visited/visited.module';
import { QuizModule } from './quiz/quiz.module';
import { FeedbackModule } from './feedback/feedback.module';
import { ReviewsModule } from './reviews/reviews.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    DonationSettingsModule,
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    CafesModule,
    AuthModule,
    SavedModule,
    SubmissionsModule,
    AdminModule,
    StorageModule,
    BlogsModule,
    VisitedModule,
    QuizModule,
    FeedbackModule,
    ReviewsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
