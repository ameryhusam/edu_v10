package com.edu.questionbank
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
class MainActivity:ComponentActivity(){override fun onCreate(state:Bundle?){super.onCreate(state);setContent{MaterialTheme{Surface(Modifier.fillMaxSize()){Column(Modifier.padding(24.dp),verticalArrangement=Arrangement.spacedBy(12.dp)){Text("اختبارات الأبناء",style=MaterialTheme.typography.headlineMedium);Text("نسخة Android لملف بنك الأسئلة والتقييم");Text("الأدوار: مدير النظام • ولي الأمر • الابن");Text("التقييم والحالة التعليمية تبقى في API الخادم.")}}}}}}