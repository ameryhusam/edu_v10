package com.edu.questionbank
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel

class MainActivity:ComponentActivity(){override fun onCreate(state:Bundle?){super.onCreate(state);setContent{MaterialTheme{QuestionBankApp()}}}}

@Composable fun QuestionBankApp(vm:MainViewModel=viewModel()){val s by vm.state;Surface(Modifier.fillMaxSize()){when(s.screen){Screen.LOGIN->LoginScreen(s,vm);Screen.HOME->HomeScreen(s,vm);Screen.BOOK->BookScreen(s,vm);Screen.QUESTION->QuestionScreen(s,vm);Screen.REPORT->ReportScreen(s,vm)}}}

@Composable fun LoginScreen(s:UiState,vm:MainViewModel){var u by remember{mutableStateOf("child")};var p by remember{mutableStateOf("1234")};Column(Modifier.fillMaxSize().padding(24.dp),verticalArrangement=Arrangement.Center){Text("اختبارات الأبناء",style=MaterialTheme.typography.headlineMedium);Text("بنك الأسئلة والتقييم");Spacer(Modifier.height(20.dp));OutlinedTextField(u,{u=it},label={Text("اسم المستخدم")},modifier=Modifier.fillMaxWidth());Spacer(Modifier.height(8.dp));OutlinedTextField(p,{p=it},label={Text("الرمز")},modifier=Modifier.fillMaxWidth());Spacer(Modifier.height(12.dp));Button({vm.login(u,p)},enabled=!s.loading,modifier=Modifier.fillMaxWidth()){Text(if(s.loading)"جارٍ الدخول..." else "دخول")};s.error?.let{Text(it,color=MaterialTheme.colorScheme.error)}}}

@Composable fun HomeScreen(s:UiState,vm:MainViewModel){Column(Modifier.fillMaxSize().padding(16.dp)){Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){Column{Text("مرحبًا \${s.user?.displayName.orEmpty()}",style=MaterialTheme.typography.headlineSmall);Text(roleLabel(s.user?.role.orEmpty()))};TextButton(vm::logout){Text("خروج")}};if(s.user?.role=="PARENT"&&s.children.isNotEmpty()){Text("اختر الابن");s.children.forEach{c->OutlinedButton({vm.selectLearner(c.id)},modifier=Modifier.fillMaxWidth()){Text(if(c.id==s.selectedLearnerId)"✓ \${c.displayName}" else c.displayName)}}};Spacer(Modifier.height(8.dp));Button(vm::openReport,modifier=Modifier.fillMaxWidth()){Text("تقرير التقدم")};Spacer(Modifier.height(12.dp));Text("الكتب",style=MaterialTheme.typography.titleLarge);LazyColumn(verticalArrangement=Arrangement.spacedBy(8.dp)){items(s.catalog?.books.orEmpty()){b->ElevatedCard(onClick={vm.openBook(b)},modifier=Modifier.fillMaxWidth()){Column(Modifier.padding(16.dp)){Text(b.title,style=MaterialTheme.typography.titleMedium);Text("\${b.units.size} وحدة")}}}};s.error?.let{Text(it,color=MaterialTheme.colorScheme.error)}}}

@Composable fun BookScreen(s:UiState,vm:MainViewModel){val b=s.selectedBook?:return;Column(Modifier.fillMaxSize().padding(16.dp)){TextButton(vm::back){Text("رجوع")};Text(b.title,style=MaterialTheme.typography.headlineSmall);LazyColumn{items(b.units){u->Text(u.title,style=MaterialTheme.typography.titleMedium,modifier=Modifier.padding(top=12.dp));u.lessons.forEach{l->OutlinedButton({vm.openLesson(l)},modifier=Modifier.fillMaxWidth().padding(vertical=2.dp)){Column(Modifier.fillMaxWidth()){Text(l.title);Text("\${l._count?.questions?:0} سؤال • \${l._count?.concepts?:0} مفهوم",style=MaterialTheme.typography.bodySmall)}}}}}}}

@Composable fun QuestionScreen(s:UiState,vm:MainViewModel){val q=s.question;Column(Modifier.fillMaxSize().padding(16.dp)){TextButton(vm::back){Text("رجوع")};if(q==null){Text(s.error?:"جارٍ تحميل السؤال...");return};Text(q.text,style=MaterialTheme.typography.headlineSmall);Spacer(Modifier.height(16.dp));val options=q.options;if(options!=null){options.forEach{o->OutlinedButton({vm.submitAnswer(o.key)},enabled=s.feedback==null,modifier=Modifier.fillMaxWidth().padding(vertical=3.dp)){Text(o.text)}}}else if(q.type=="TRUE_FALSE"){Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){Button({vm.submitAnswer("true")},enabled=s.feedback==null){Text("صح")};Button({vm.submitAnswer("false")},enabled=s.feedback==null){Text("خطأ")}}}else{Text("هذا النوع يحتاج حقل إدخال نصي وسيُضاف في المرحلة التالية.")};s.feedback?.let{r->Spacer(Modifier.height(20.dp));Text(if(r.isCorrect)"إجابة صحيحة ✓" else "إجابة غير صحيحة",style=MaterialTheme.typography.titleLarge);r.explanation?.let{Text(it)};Button(vm::nextQuestion){Text("السؤال التالي")}}}}

@Composable fun ReportScreen(s:UiState,vm:MainViewModel){Column(Modifier.fillMaxSize().padding(16.dp)){TextButton(vm::back){Text("رجوع")};Text("تقرير التقدم",style=MaterialTheme.typography.headlineSmall);if(s.report.isEmpty())Text("لا توجد محاولات مسجلة بعد.");LazyColumn(verticalArrangement=Arrangement.spacedBy(8.dp)){items(s.report){r->ElevatedCard(Modifier.fillMaxWidth()){Column(Modifier.padding(14.dp)){Text(r.concept);Text("الإتقان: \${"%.0f".format(r.mastery*100)}%");Text("المحاولات: \${r.attempts} • الصحيح: \${r.correct}")}}}}}}

fun roleLabel(r:String)=when(r){"SYSTEM_ADMIN"->"مدير النظام";"PARENT"->"ولي الأمر";"CHILD"->"الابن";else->r}
