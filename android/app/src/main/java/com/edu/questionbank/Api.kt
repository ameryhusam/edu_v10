package com.edu.questionbank
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory

data class LoginRequest(val username:String,val pin:String)
data class LoginResponse(val token:String,val user:User)
data class User(val id:String,val username:String,val displayName:String,val role:String)
data class Child(val id:String,val username:String,val displayName:String,val role:String)
data class Grade(val id:String,val nameAr:String)
data class Subject(val id:String,val nameAr:String,val iconName:String?)
data class LessonCount(val questions:Int,val concepts:Int)
data class Lesson(val id:String,val key:String,val orderIndex:Int,val title:String,val branch:String?,val printedStartPage:Int?,val printedEndPage:Int?,val _count:LessonCount?)
data class Unit(val id:String,val key:String,val orderIndex:Int,val title:String,val lessons:List<Lesson>)
data class Book(val id:String,val key:String,val gradeId:String,val subjectId:String,val title:String,val part:String?,val semester:String?,val units:List<Unit>)
data class Catalog(val grades:List<Grade>,val subjects:List<Subject>,val books:List<Book>)
data class QuestionOption(val key:String,val text:String)
data class Question(val id:String,val key:String,val lessonId:String,val text:String,val type:String,val options:List<QuestionOption>?,val explanation:String?,val difficulty:Double,val sourcePage:Int?,val origin:String)
data class AttemptResult(val id:String,val isCorrect:Boolean,val guessScore:Double,val explanation:String?)
data class ConceptReport(val conceptId:String,val concept:String,val mastery:Double,val theta:Double,val attempts:Int,val correct:Int,val guessedCount:Int,val lastUpdated:String)
data class SubmitAttempt(val learnerId:String,val questionId:String,val lessonId:String,val selectedAnswer:String,val timeMs:Int?=null)

interface QuestionBankApi {
 @POST("v1/auth/login") suspend fun login(@Body body:LoginRequest):LoginResponse
 @GET("v1/catalog") suspend fun catalog(@Header("Authorization") token:String):Catalog
 @GET("v1/children") suspend fun children(@Header("Authorization") token:String):List<Child>
 @GET("v1/lessons/{lessonId}/next") suspend fun nextQuestion(@Header("Authorization") token:String,@Path("lessonId") lessonId:String,@Query("learnerId") learnerId:String,@Query("excluded") excluded:String?=null):Question
 @POST("v1/attempts") suspend fun submit(@Header("Authorization") token:String,@Body body:SubmitAttempt):AttemptResult
 @GET("v1/learners/{learnerId}/report") suspend fun report(@Header("Authorization") token:String,@Path("learnerId") learnerId:String):List<ConceptReport>
}
object Api {
 private val BASE_URL=BuildConfig.API_BASE_URL
 val service:QuestionBankApi by lazy { Retrofit.Builder().baseUrl(BASE_URL).addConverterFactory(GsonConverterFactory.create()).build().create(QuestionBankApi::class.java) }
}
