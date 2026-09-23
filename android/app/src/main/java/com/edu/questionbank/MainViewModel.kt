package com.edu.questionbank
import android.app.Application
import android.content.Context
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.launch

enum class Screen{LOGIN,HOME,BOOK,QUESTION,REPORT}
data class UiState(val screen:Screen=Screen.LOGIN,val loading:Boolean=false,val error:String?=null,val token:String?=null,val user:User?=null,val children:List<Child> = emptyList(),val selectedLearnerId:String?=null,val catalog:Catalog?=null,val selectedBook:Book?=null,val selectedLesson:Lesson?=null,val question:Question?=null,val feedback:AttemptResult?=null,val report:List<ConceptReport> = emptyList())

class MainViewModel(app:Application):AndroidViewModel(app){
 private val prefs=app.getSharedPreferences("session",Context.MODE_PRIVATE)
 var state=androidx.compose.runtime.mutableStateOf(UiState());private set
 init{val t=prefs.getString("token",null);val id=prefs.getString("userId",null);val r=prefs.getString("role",null);val n=prefs.getString("name",null);if(t!=null&&id!=null&&r!=null&&n!=null){state.value=state.value.copy(token=t,user=User(id,"",n,r),selectedLearnerId=if(r=="CHILD")id else null,screen=Screen.HOME);loadCatalog();if(r=="PARENT")loadChildren()}}
 fun login(u:String,p:String)=viewModelScope.launch{state.value=state.value.copy(loading=true,error=null);try{val x=Api.service.login(LoginRequest(u,p));prefs.edit().putString("token",x.token).putString("userId",x.user.id).putString("role",x.user.role).putString("name",x.user.displayName).apply();state.value=state.value.copy(loading=false,token=x.token,user=x.user,selectedLearnerId=if(x.user.role=="CHILD")x.user.id else null,screen=Screen.HOME);loadCatalog();if(x.user.role=="PARENT")loadChildren()}catch(_:Exception){state.value=state.value.copy(loading=false,error="تعذر تسجيل الدخول.")}}
 fun loadCatalog()=viewModelScope.launch{val t=state.value.token?:return@launch;try{state.value=state.value.copy(catalog=Api.service.catalog("Bearer $t"))}catch(_:Exception){state.value=state.value.copy(error="تعذر تحميل البيانات.")}}
 private fun loadChildren()=viewModelScope.launch{val t=state.value.token?:return@launch;try{val c=Api.service.children("Bearer $t");state.value=state.value.copy(children=c,selectedLearnerId=c.firstOrNull()?.id)}catch(_:Exception){state.value=state.value.copy(error="تعذر تحميل الأبناء.")}}
 fun selectLearner(id:String){state.value=state.value.copy(selectedLearnerId=id)}
 fun openBook(b:Book){state.value=state.value.copy(selectedBook=b,screen=Screen.BOOK)}
 fun openLesson(l:Lesson){state.value=state.value.copy(selectedLesson=l,question=null,feedback=null,error=null,screen=Screen.QUESTION);nextQuestion()}
 fun nextQuestion()=viewModelScope.launch{val t=state.value.token?:return@launch;val learner=state.value.selectedLearnerId?:return@launch;val lesson=state.value.selectedLesson?:return@launch;try{val q=Api.service.nextQuestion("Bearer $t",lesson.id,learner,state.value.question?.id);state.value=state.value.copy(question=q,feedback=null,error=null)}catch(_:Exception){state.value=state.value.copy(question=null,error="لا توجد أسئلة متاحة لهذا الدرس.")}}
 fun submitAnswer(a:String)=viewModelScope.launch{val t=state.value.token?:return@launch;val learner=state.value.selectedLearnerId?:return@launch;val lesson=state.value.selectedLesson?:return@launch;val q=state.value.question?:return@launch;try{val r=Api.service.submit("Bearer $t",SubmitAttempt(learner,q.id,lesson.id,a));state.value=state.value.copy(feedback=r)}catch(_:Exception){state.value=state.value.copy(error="تعذر تسجيل الإجابة.")}}
 fun openReport()=viewModelScope.launch{val t=state.value.token?:return@launch;val learner=state.value.selectedLearnerId?:return@launch;try{state.value=state.value.copy(report=Api.service.report("Bearer $t",learner),screen=Screen.REPORT)}catch(_:Exception){state.value=state.value.copy(error="تعذر تحميل التقرير.")}}
 fun back(){state.value=when(state.value.screen){Screen.BOOK->state.value.copy(screen=Screen.HOME);Screen.QUESTION->state.value.copy(screen=Screen.BOOK);Screen.REPORT->state.value.copy(screen=Screen.HOME);else->state.value}}
 fun logout(){prefs.edit().clear().apply();state.value=UiState()}
}
